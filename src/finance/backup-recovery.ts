// @ts-ignore TS5097: the app's runtime uses native ESM TypeScript imports.
import { createRestorePlan, validateNativeBackup, type BackupOwner, type NativeBackup, type RestoreCheckpoint, type RestoreDomain } from './backup.ts';

export type RestoreMode = 'merge' | 'replace';
export type SnapshotBaseline = { snapshot: NativeBackup; token: string };
export type RestoreReceipt = {
  operationId: string;
  payloadFingerprint: string;
  restoredSnapshot: NativeBackup;
};
export type RestoreRpcRequest = {
  operationId: string;
  householdId: string;
  expectedMembershipVersion?: string;
  expectedBaselineToken: string;
  payloadFingerprint: string;
  mode: RestoreMode;
  confirmFullReplacement: boolean;
  acceptedConflictIds: string[];
  keptCurrentConflictIds: string[];
  /** Original, validated backup. The server derives the merged snapshot from this and the choices. */
  snapshot: NativeBackup;
};

export type RestoreAdapter = {
  /** Must derive the owner from the verified auth session, never from user_metadata. */
  getAuthenticatedOwner: () => Promise<BackupOwner | null>;
  readCurrentSnapshot: (owner: BackupOwner) => Promise<SnapshotBaseline>;
  /** Omit until the matching authenticated, atomic server RPC is available. */
  restoreSnapshot?: (request: RestoreRpcRequest) => Promise<RestoreReceipt>;
  /** Read-only receipt lookup, scoped by the adapter to the authenticated owner and household. */
  findRestoreReceipt?: (operationId: string, owner?: BackupOwner) => Promise<RestoreReceipt | null>;
  checkpoints: {
    load: (owner: BackupOwner) => Promise<RestoreCheckpoint | null>;
    begin: (owner: BackupOwner, before: NativeBackup, incoming: NativeBackup, options?: {
      acknowledgeReplacement?: boolean;
      operationId?: string;
      baselineToken?: string;
      payloadFingerprint?: string;
      requestVersion?: 2;
      resolutionMode?: RestoreMode;
      acceptedConflictIds?: string[];
      keptCurrentConflictIds?: string[];
    }) => Promise<RestoreCheckpoint>;
    update: (owner: BackupOwner, progress: { status: RestoreCheckpoint['status']; cursor: number; error?: string; payloadFingerprint?: string; legacyPayloadFingerprint?: string; requestVersion?: 2 }) => Promise<RestoreCheckpoint>;
  };
};

export type RestoreOptions = {
  operationId: string;
  mode: RestoreMode;
  /** For merge, the exact `domain:id` conflict keys the user accepted. */
  acceptedConflictIds?: string[];
  /** Merge requires an explicit incoming/current choice for every conflict. */
  keptCurrentConflictIds?: string[];
  /** Required for replace: user explicitly confirmed all-domain replacement/deletion. */
  confirmFullReplacement?: boolean;
  /** Required only to replace a different active/failed local checkpoint. */
  acknowledgeCheckpointReplacement?: boolean;
};

/** A confirmed `snapshot` is authoritative server readback; callers replace their cached domain state from it. */
export type RestoreResult =
  | { status: 'confirmed'; operationId: string; snapshot: NativeBackup; recoveredAfterLostResponse: boolean }
  | { status: 'rejected' | 'unavailable' | 'uncertain'; operationId: string; message: string; checkpoint: RestoreCheckpoint | null };

/** Adapters should use this only after receiving a conclusive server rejection. */
export class RestoreRejectedError extends Error {
  constructor(message: string) { super(message); this.name = 'RestoreRejectedError'; }
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const canonical = (value: any): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
function requireId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 512) throw new TypeError(`Invalid ${label}`);
}
function isReceipt(value: unknown, operationId: string, fingerprint: string): value is RestoreReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as RestoreReceipt;
  return receipt.operationId === operationId && receipt.payloadFingerprint === fingerprint && !!receipt.restoredSnapshot;
}
function isCheckpointReceipt(value: unknown, operationId: string, checkpoint: RestoreCheckpoint): value is RestoreReceipt {
  return isReceipt(value, operationId, checkpoint.payloadFingerprint ?? '')
    || (!!checkpoint.legacyPayloadFingerprint && isReceipt(value, operationId, checkpoint.legacyPayloadFingerprint));
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function resolvedSnapshot(incoming: NativeBackup, current: NativeBackup, mode: RestoreMode, accepted: Set<string>): NativeBackup {
  if (mode === 'replace') return clone(incoming);
  const next = clone(current);
  const onboardingKey = `onboardingData:${incoming.userId}`;
  if (accepted.has(onboardingKey)) {
    next.onboardingData = { ...clone(incoming.onboardingData), debts: clone(current.onboardingData.debts) };
  }
  const domains: [RestoreDomain, keyof NativeBackup, keyof NativeBackup][] = [
    ['debts', 'onboardingData', 'onboardingData'],
    ['recurringBills', 'recurringBills', 'recurringBills'],
    ['transactions', 'transactions', 'transactions'],
    ['reconciliationAnchors', 'reconciliationAnchors', 'reconciliationAnchors'],
  ];
  for (const [domain, incomingKey, currentKey] of domains) {
    const incomingRows: any[] = domain === 'debts'
      ? incoming.onboardingData.debts as any[]
      : (incoming as any)[incomingKey];
    const currentRows: any[] = domain === 'debts'
      ? next.onboardingData.debts as any[]
      : (next as any)[currentKey];
    const byId = new Map(currentRows.map((row) => [row.id, row]));
    for (const row of incomingRows) {
      const key = `${domain}:${row.id}`;
      if (!byId.has(row.id) || accepted.has(key)) byId.set(row.id, clone(row));
    }
    if (domain === 'debts') next.onboardingData.debts = Array.from(byId.values()) as any;
    else (next as any)[currentKey] = Array.from(byId.values());
  }
  if (Array.isArray(next.onboardingData.archivedPaidOffDebtIds)) {
    const zeroDebtIds = new Set(next.onboardingData.debts.filter((debt) => debt.balance === 0).map((debt) => debt.id));
    next.onboardingData.archivedPaidOffDebtIds = next.onboardingData.archivedPaidOffDebtIds.filter((id) => zeroDebtIds.has(id));
  }
  return next;
}

/**
 * Executes one owner-scoped, atomic server snapshot restore. This service is
 * disabled until a verified adapter supplies the corresponding RPC and receipt
 * lookup. It never simulates server persistence locally.
 */
export function createNativeBackupRecovery(adapter: RestoreAdapter) {
  return {
    async restore(incoming: NativeBackup, options: RestoreOptions): Promise<RestoreResult> {
      requireId(options.operationId, 'restore operation ID');
      if (options.mode !== 'merge' && options.mode !== 'replace') throw new TypeError('Invalid restore mode');
      const sessionOwner = await adapter.getAuthenticatedOwner();
      if (!sessionOwner) return { status: 'rejected', operationId: options.operationId, message: 'Sign in before restoring a backup.', checkpoint: null };
      validateNativeBackup(incoming, sessionOwner);
      if (sessionOwner.role !== undefined && sessionOwner.role !== 'owner') {
        return { status: 'rejected', operationId: options.operationId, message: 'Only the household owner can restore a backup.', checkpoint: null };
      }
      const accepted = new Set(options.acceptedConflictIds ?? []);
      const kept = new Set(options.keptCurrentConflictIds ?? []);
      for (const key of accepted) requireId(key, 'accepted conflict ID');
      for (const key of kept) requireId(key, 'kept conflict ID');
      if (options.mode === 'replace' && options.confirmFullReplacement !== true) {
        return { status: 'rejected', operationId: options.operationId, message: 'Full replacement and deletion of omitted records requires explicit confirmation.', checkpoint: null };
      }
      const existing = await adapter.checkpoints.load(sessionOwner);
      const sortedAccepted = [...accepted].sort();
      const sortedKept = [...kept].sort();
      const existingModeMatches = (existing?.resolutionMode ?? 'merge') === options.mode;
      const existingRequestMatches = !!existing && existing.operationId === options.operationId
        && canonical(existing.incoming) === canonical(incoming)
        && existingModeMatches
        && canonical([...(existing.acceptedConflictIds ?? [])].sort()) === canonical(sortedAccepted)
        && canonical([...(existing.keptCurrentConflictIds ?? [])].sort()) === canonical(sortedKept);
      const membershipVersionChanged = !!existing?.owner.membershipVersion
        && !!sessionOwner.membershipVersion
        && existing.owner.membershipVersion !== sessionOwner.membershipVersion;
      if (existingRequestMatches && existing!.status === 'completed') {
        if (!adapter.findRestoreReceipt) {
          return { status: 'uncertain', operationId: options.operationId, message: 'The completed restore receipt cannot be verified. Keep this checkpoint and contact support before retrying.', checkpoint: existing };
        }
        try {
          const receipt = await adapter.findRestoreReceipt(options.operationId, sessionOwner);
          if (receipt && isCheckpointReceipt(receipt, options.operationId, existing!)) {
            validateNativeBackup(receipt.restoredSnapshot, sessionOwner);
            return { status: 'confirmed', operationId: options.operationId, snapshot: clone(receipt.restoredSnapshot), recoveredAfterLostResponse: true };
          }
          if (receipt) {
            return { status: 'rejected', operationId: options.operationId, message: 'Restore operation ID is already bound to different data.', checkpoint: existing };
          }
          return { status: 'uncertain', operationId: options.operationId, message: 'The completed restore has no server receipt. Keep this checkpoint and contact support before retrying.', checkpoint: existing };
        } catch {
          return { status: 'uncertain', operationId: options.operationId, message: 'The completed restore receipt could not be checked. Keep this checkpoint and retry after receipt lookup is available.', checkpoint: existing };
        }
      }
      if (existingRequestMatches && membershipVersionChanged) {
        if (adapter.findRestoreReceipt) {
          try {
            const receipt = await adapter.findRestoreReceipt(options.operationId, sessionOwner);
            if (receipt && isCheckpointReceipt(receipt, options.operationId, existing!)) {
              validateNativeBackup(receipt.restoredSnapshot, sessionOwner);
              return { status: 'confirmed', operationId: options.operationId, snapshot: clone(receipt.restoredSnapshot), recoveredAfterLostResponse: true };
            }
            if (receipt) {
              return { status: 'rejected', operationId: options.operationId, message: 'Restore operation ID is already bound to different data.', checkpoint: existing };
            }
          } catch {
            return { status: 'uncertain', operationId: options.operationId, message: 'Household membership changed and the previous restore receipt could not be checked. Keep this checkpoint before retrying.', checkpoint: existing };
          }
        }
        return { status: 'rejected', operationId: options.operationId, message: 'Household membership changed since this restore checkpoint was created. Acknowledge replacement and refresh before retrying.', checkpoint: existing };
      }
      const retry = !!existing && existing.status !== 'completed' && !membershipVersionChanged && existing.operationId === options.operationId
        && canonical(existing.incoming) === canonical(incoming)
        && existingModeMatches
        && canonical([...(existing.acceptedConflictIds ?? [])].sort()) === canonical(sortedAccepted)
        && canonical([...(existing.keptCurrentConflictIds ?? [])].sort()) === canonical(sortedKept)
        && !!existing.baselineToken && !!existing.payloadFingerprint;
      const legacyRetry = retry && existing!.requestVersion !== 2;
      let baseline: SnapshotBaseline;
      if (retry) baseline = { snapshot: existing!.before, token: existing!.baselineToken! };
      else {
        baseline = await adapter.readCurrentSnapshot(sessionOwner);
        requireId(baseline.token, 'current snapshot baseline token');
      }
      validateNativeBackup(baseline.snapshot, sessionOwner);
      const plan = createRestorePlan(incoming, baseline.snapshot, sessionOwner);
      const conflictIds = new Set(plan.operations.filter((op) => op.action === 'conflict').map((op) => `${op.domain}:${op.id}`));
      if ([...accepted].some((key) => !conflictIds.has(key))) throw new TypeError('Accepted conflicts must match current snapshot conflicts');
      if ([...kept].some((key) => !conflictIds.has(key))) throw new TypeError('Kept conflicts must match current snapshot conflicts');
      if (options.mode === 'merge' && [...conflictIds].some((key) => accepted.has(key) === kept.has(key))) {
        return { status: 'rejected', operationId: options.operationId, message: 'Choose whether to use the backup or keep the current value for every conflict.', checkpoint: existing };
      }
      if (options.mode === 'replace' && (accepted.size || kept.size)) throw new TypeError('Replacement uses the explicit full-replacement confirmation, not per-conflict selections');
      const desired = resolvedSnapshot(incoming, baseline.snapshot, options.mode, accepted);
      validateNativeBackup(desired, sessionOwner);
      const fingerprintOwner = {
        userId: sessionOwner.userId,
        householdId: sessionOwner.householdId,
        ...(sessionOwner.membershipVersion !== undefined ? { membershipVersion: sessionOwner.membershipVersion } : {}),
      };
      const payloadFingerprint = retry && !legacyRetry
        ? existing!.payloadFingerprint!
        : await fingerprint({ owner: fingerprintOwner, expectedBaselineToken: baseline.token, mode: options.mode, confirmFullReplacement: options.confirmFullReplacement === true, acceptedConflictIds: sortedAccepted, keptCurrentConflictIds: sortedKept, snapshot: incoming });
      const isRetry = retry;
      let checkpoint: RestoreCheckpoint;
      if (isRetry) checkpoint = existing!;
      else {
        try {
          checkpoint = await adapter.checkpoints.begin(sessionOwner, baseline.snapshot, incoming, {
            operationId: options.operationId,
            baselineToken: baseline.token,
            payloadFingerprint,
            requestVersion: 2,
            resolutionMode: options.mode,
            acceptedConflictIds: sortedAccepted,
            keptCurrentConflictIds: sortedKept,
            acknowledgeReplacement: options.acknowledgeCheckpointReplacement === true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'A previous restore checkpoint needs review.';
          return { status: 'rejected', operationId: options.operationId, message, checkpoint: existing };
        }
      }

      let legacyReceiptChecked = false;
      if (legacyRetry) {
        if (!adapter.findRestoreReceipt) {
          return { status: 'uncertain', operationId: options.operationId, message: 'This restore checkpoint uses the previous request format. A receipt lookup is required before it can be retried safely.', checkpoint };
        }
        try {
          const receipt = await adapter.findRestoreReceipt(options.operationId, sessionOwner);
          legacyReceiptChecked = true;
          if (receipt && isReceipt(receipt, options.operationId, existing!.payloadFingerprint!)) {
            validateNativeBackup(receipt.restoredSnapshot, sessionOwner);
            await adapter.checkpoints.update(sessionOwner, { status: 'completed', cursor: checkpoint.plan.operations.length });
            return { status: 'confirmed', operationId: options.operationId, snapshot: clone(receipt.restoredSnapshot), recoveredAfterLostResponse: true };
          }
          if (receipt) {
            const saved = await adapter.checkpoints.update(sessionOwner, { status: 'failed', cursor: checkpoint.cursor, error: 'Operation ID is already bound to a different payload.' });
            return { status: 'rejected', operationId: options.operationId, message: 'Restore operation ID is already bound to different data.', checkpoint: saved };
          }
          checkpoint = await adapter.checkpoints.update(sessionOwner, {
            status: checkpoint.status,
            cursor: checkpoint.cursor,
            payloadFingerprint,
            legacyPayloadFingerprint: existing!.payloadFingerprint!,
            requestVersion: 2,
          });
        } catch {
          return { status: 'uncertain', operationId: options.operationId, message: 'The previous-format restore receipt could not be checked. Keep this checkpoint and retry after receipt lookup is available.', checkpoint };
        }
      }

      if (retry && !legacyReceiptChecked && adapter.findRestoreReceipt) {
        try {
          const receipt = await adapter.findRestoreReceipt(options.operationId, sessionOwner);
          if (isCheckpointReceipt(receipt, options.operationId, checkpoint)) {
            validateNativeBackup(receipt.restoredSnapshot, sessionOwner);
            await adapter.checkpoints.update(sessionOwner, { status: 'completed', cursor: checkpoint.plan.operations.length });
            return { status: 'confirmed', operationId: options.operationId, snapshot: clone(receipt.restoredSnapshot), recoveredAfterLostResponse: true };
          }
          if (receipt && !isCheckpointReceipt(receipt, options.operationId, checkpoint)) {
            const saved = await adapter.checkpoints.update(sessionOwner, { status: 'failed', cursor: checkpoint.cursor, error: 'Operation ID is already bound to a different payload.' });
            return { status: 'rejected', operationId: options.operationId, message: 'Restore operation ID is already bound to different data.', checkpoint: saved };
          }
        } catch {
          // Continue with the same stable operation ID; the server must enforce idempotency.
        }
      }

      if (!adapter.restoreSnapshot) {
        const saved = await adapter.checkpoints.update(sessionOwner, { status: 'failed', cursor: checkpoint.cursor, error: 'Atomic native restore RPC is unavailable.' });
        return { status: 'unavailable', operationId: options.operationId, message: 'Native restore is unavailable until the authenticated atomic restore RPC is installed and verified.', checkpoint: saved };
      }

      const request: RestoreRpcRequest = {
        operationId: options.operationId,
        householdId: sessionOwner.householdId,
        ...(sessionOwner.membershipVersion !== undefined ? { expectedMembershipVersion: sessionOwner.membershipVersion } : {}),
        expectedBaselineToken: baseline.token,
        payloadFingerprint,
        mode: options.mode,
        confirmFullReplacement: options.confirmFullReplacement === true,
        acceptedConflictIds: [...accepted].sort(),
        keptCurrentConflictIds: [...kept].sort(),
        snapshot: clone(incoming),
      };
      try {
        const receipt = await adapter.restoreSnapshot(request);
        if (!isReceipt(receipt, options.operationId, payloadFingerprint)) throw new Error('Restore RPC returned an invalid operation receipt.');
        validateNativeBackup(receipt.restoredSnapshot, sessionOwner);
        await adapter.checkpoints.update(sessionOwner, { status: 'completed', cursor: checkpoint.plan.operations.length });
        return { status: 'confirmed', operationId: options.operationId, snapshot: clone(receipt.restoredSnapshot), recoveredAfterLostResponse: false };
      } catch (rpcError) {
        const rpcMessage = rpcError instanceof Error ? rpcError.message : 'Restore request failed.';
        if (rpcError instanceof RestoreRejectedError) {
          if (adapter.findRestoreReceipt) {
            try {
              const receipt = await adapter.findRestoreReceipt(options.operationId, sessionOwner);
              if (isCheckpointReceipt(receipt, options.operationId, checkpoint)) {
                validateNativeBackup(receipt.restoredSnapshot, sessionOwner);
                await adapter.checkpoints.update(sessionOwner, { status: 'completed', cursor: checkpoint.plan.operations.length });
                return { status: 'confirmed', operationId: options.operationId, snapshot: clone(receipt.restoredSnapshot), recoveredAfterLostResponse: true };
              }
              if (receipt) {
                const saved = await adapter.checkpoints.update(sessionOwner, { status: 'failed', cursor: checkpoint.cursor, error: 'Operation ID is already bound to a different payload.' });
                return { status: 'rejected', operationId: options.operationId, message: 'Restore operation ID is already bound to different data.', checkpoint: saved };
              }
            } catch {
              return { status: 'uncertain', operationId: options.operationId, message: 'The restore was rejected, but its receipt could not be checked. Keep this checkpoint and retry after receipt lookup is available.', checkpoint };
            }
          }
          const saved = await adapter.checkpoints.update(sessionOwner, { status: 'failed', cursor: checkpoint.cursor, error: rpcMessage });
          return { status: 'rejected', operationId: options.operationId, message: rpcMessage, checkpoint: saved };
        }
        // A thrown request may have committed before its response was lost. A receipt lookup is read-only.
        if (adapter.findRestoreReceipt) {
          try {
            const receipt = await adapter.findRestoreReceipt(options.operationId, sessionOwner);
            if (isCheckpointReceipt(receipt, options.operationId, checkpoint)) {
              validateNativeBackup(receipt.restoredSnapshot, sessionOwner);
              await adapter.checkpoints.update(sessionOwner, { status: 'completed', cursor: checkpoint.plan.operations.length });
              return { status: 'confirmed', operationId: options.operationId, snapshot: clone(receipt.restoredSnapshot), recoveredAfterLostResponse: true };
            }
            if (receipt && !isCheckpointReceipt(receipt, options.operationId, checkpoint)) {
              const saved = await adapter.checkpoints.update(sessionOwner, { status: 'failed', cursor: checkpoint.cursor, error: 'Operation ID is already bound to a different payload.' });
              return { status: 'rejected', operationId: options.operationId, message: 'Restore operation ID is already bound to different data.', checkpoint: saved };
            }
          } catch {
            // Receipt lookup failure leaves the result uncertain; never retry with a new operation ID automatically.
          }
        }
        const saved = await adapter.checkpoints.update(sessionOwner, { status: 'failed', cursor: checkpoint.cursor, error: `Restore outcome uncertain: ${rpcMessage}` });
        return { status: 'uncertain', operationId: options.operationId, message: 'The restore outcome could not be confirmed. Retry with the same operation ID after checking the server receipt.', checkpoint: saved };
      }
    },
  };
}
