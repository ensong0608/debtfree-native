/**
 * Durable, cache-only journal for financial commands. This module has no Expo,
 * network, or database dependencies; callers supply their own key/value store
 * and authoritative readback evidence.
 */

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type PendingState = 'pending' | 'conflict' | 'needs_review';
export type FinanceDomain = 'transactions' | 'bills' | 'anchors' | string;

export type PendingRowIntent = {
  domain: FinanceDomain;
  rowId: string;
  /** null means the command intends the row to be absent. */
  desired: unknown | null;
};

export type PendingCommand = {
  commandId: string;
  kind: string;
  userId: string;
  expectedVersions: Record<string, string | number | null>;
  payload: unknown;
  members: PendingRowIntent[];
  state: PendingState;
  createdAt: string;
  updatedAt: string;
  dispatchState?: 'not_dispatched' | 'dispatched' | 'uncertain';
  failure?: { kind: 'rejected' | 'uncertain'; message: string };
  reviewReason?: string;
  diagnostic?: { sourceDomain: string; raw: string; reason: string };
  resolution?: { kind: 'accepted_server_state'; at: string; acknowledged: true; evidence: { domains: Record<string, { authoritative: true; complete: true; rowCount: number }>; observedMembers: Array<{ domain: string; rowId: string; row: unknown | null }> } };
};

type JournalEnvelope = { version: 1; userId: string; commands: PendingCommand[] };

export type ReadbackSnapshot = {
  /** True only when the caller has a complete authoritative snapshot for domain. */
  authoritative: boolean;
  complete: boolean;
  rows: readonly { id: string; row: unknown }[];
};

export type ReadbackEvidence = {
  byDomain: Readonly<Record<string, ReadbackSnapshot | undefined>>;
  /** Explicit proof that the complete atomic command, including all side effects,
   * was committed. Required for grouped reconciliation commands. */
  completeCommandIds?: readonly string[];
};

export type PendingSummary = {
  total: number;
  pending: number;
  conflict: number;
  needs_review: number;
  rejected: number;
  resolved: number;
  byDomain: Record<string, number>;
};

const queues = new WeakMap<KeyValueStore, Map<string, Promise<void>>>();

function lock<T>(store: KeyValueStore, userId: string, work: () => Promise<T>): Promise<T> {
  let userQueues = queues.get(store);
  if (!userQueues) { userQueues = new Map(); queues.set(store, userQueues); }
  const previous = userQueues.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  userQueues.set(userId, tail);
  return previous.catch(() => {}).then(work).finally(() => {
    release();
    if (userQueues?.get(userId) === tail) userQueues.delete(userId);
  });
}

function storageKey(userId: string, explicit?: string): string {
  if (explicit) return explicit;
  const safeUser = userId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `debtfree-pending-journal-v1.${safeUser}`;
}

function parseEnvelope(raw: string | null, userId: string): JournalEnvelope {
  if (raw === null) return { version: 1, userId, commands: [] };
  const parsed = JSON.parse(raw) as Partial<JournalEnvelope>;
  if (parsed.version !== 1 || parsed.userId !== userId || !Array.isArray(parsed.commands)) {
    throw new Error('Pending journal is malformed or belongs to a different user.');
  }
  const envelope = parsed as JournalEnvelope;
  const ids = new Set<string>();
  for (const command of envelope.commands) {
    validateCommand(command, userId);
    if (ids.has(command.commandId)) throw new Error('Pending journal contains duplicate command identities.');
    ids.add(command.commandId);
  }
  return envelope;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function validateCommand(command: PendingCommand, userId: string): void {
  if (!command.commandId || !command.kind || command.userId !== userId) throw new TypeError('Command identity, kind, and matching userId are required.');
  if (!command.expectedVersions || typeof command.expectedVersions !== 'object' || Array.isArray(command.expectedVersions)) throw new TypeError('Command expectedVersions must be an object.');
  if (typeof command.createdAt !== 'string' || typeof command.updatedAt !== 'string') throw new TypeError('Command timestamps are required.');
  if (!Array.isArray(command.members) || (command.members.length === 0 && !(command.kind === 'migration_diagnostic' && command.diagnostic))) throw new TypeError('A command must contain at least one row intent.');
  if (command.members.some(member => !member.domain || !member.rowId || !Object.prototype.hasOwnProperty.call(member, 'desired'))) throw new TypeError('Every row intent requires a domain, rowId, and desired state.');
  if (!['pending', 'conflict', 'needs_review'].includes(command.state)) throw new TypeError('Invalid pending command state.');
  if (command.dispatchState !== undefined && !['not_dispatched', 'dispatched', 'uncertain'].includes(command.dispatchState)) throw new TypeError('Invalid command dispatch state.');
}

function validateEnvelope(envelope: JournalEnvelope, userId: string): JournalEnvelope {
  if (envelope.version !== 1 || envelope.userId !== userId || !Array.isArray(envelope.commands)) throw new Error('Pending journal is malformed or belongs to a different user.');
  const ids = new Set<string>();
  for (const command of envelope.commands) {
    validateCommand(command, userId);
    if (ids.has(command.commandId)) throw new Error('Pending journal contains duplicate command identities.');
    ids.add(command.commandId);
  }
  return envelope;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter(key => !['created_at', 'updated_at', 'createdAt', 'updatedAt', 'is_pending'].includes(key))
    .map(key => {
      const item = record[key];
      const value = ['amount', 'principal_amount', 'interest_amount', 'escrow_amount', 'fee_amount', 'verified_balance'].includes(key) && item != null
        ? canonicalDecimal(item) : key === 'deleted_at' && item != null ? 'deleted' : item;
      return `${JSON.stringify(key)}:${stable(value)}`;
    }).join(',')}}`;
}

export function rowMatches(observed: unknown, desired: unknown): boolean {
  return stable(observed) === stable(desired);
}

function canonicalDecimal(value: unknown): string {
  const input = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : String(value);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(input);
  if (!match) return `invalid:${input}`;
  const whole = match[2].replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const zero = /^0+$/.test(whole) && fraction.length === 0;
  return `${match[1] === '-' && !zero ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function createPendingJournal(store: KeyValueStore, options: { key?: (userId: string) => string } = {}) {
  const keyFor = (userId: string) => options.key?.(userId) ?? storageKey(userId);

  async function read(userId: string): Promise<JournalEnvelope> {
    return parseEnvelope(await store.getItem(keyFor(userId)), userId);
  }
  async function write(userId: string, envelope: JournalEnvelope): Promise<void> {
    await store.setItem(keyFor(userId), JSON.stringify(envelope));
  }
  async function mutate(userId: string, change: (envelope: JournalEnvelope) => JournalEnvelope): Promise<void> {
    return lock(store, userId, async () => write(userId, validateEnvelope(change(await read(userId)), userId)));
  }

  return {
    async save(command: PendingCommand): Promise<PendingCommand> {
      validateCommand(command, command.userId);
      const saved = clone(command);
      await mutate(command.userId, envelope => {
        if (envelope.commands.some(item => item.commandId === saved.commandId)) throw new Error(`Command '${saved.commandId}' already exists.`);
        envelope.commands.push(saved);
        return envelope;
      });
      return clone(saved);
    },
    async update(userId: string, commandId: string, patch: Partial<Omit<PendingCommand, 'commandId' | 'kind' | 'userId' | 'createdAt' | 'expectedVersions'>>): Promise<PendingCommand> {
      let result: PendingCommand | undefined;
      await mutate(userId, envelope => {
        const index = envelope.commands.findIndex(item => item.commandId === commandId);
        if (index < 0) throw new Error(`Command '${commandId}' was not found.`);
        const current = envelope.commands[index];
        result = { ...current, ...clone(patch), commandId, userId, createdAt: current.createdAt };
        envelope.commands[index] = result;
        return envelope;
      });
      return clone(result!);
    },
    async remove(userId: string, commandId: string): Promise<boolean> {
      let removed = false;
      await mutate(userId, envelope => {
        const next = envelope.commands.filter(item => item.commandId !== commandId);
        removed = next.length !== envelope.commands.length;
        envelope.commands = next;
        return envelope;
      });
      return removed;
    },
    async get(userId: string, commandId: string): Promise<PendingCommand | undefined> {
      return lock(store, userId, async () => clone((await read(userId)).commands.find(item => item.commandId === commandId)));
    },
    async list(userId: string): Promise<PendingCommand[]> {
      return lock(store, userId, async () => clone((await read(userId)).commands));
    },
    async summarize(userId: string): Promise<PendingSummary> {
      const commands = await this.list(userId);
      const summary: PendingSummary = { total: 0, pending: 0, conflict: 0, needs_review: 0, rejected: 0, resolved: 0, byDomain: {} };
      for (const command of commands) {
        if (command.resolution) { summary.resolved++; continue; }
        if (command.failure?.kind === 'rejected') { summary.rejected++; continue; }
        summary.total++;
        summary[command.state]++;
        const domains = command.members.length ? command.members.map(member => member.domain) : command.diagnostic ? [command.diagnostic.sourceDomain] : [];
        for (const domain of new Set(domains)) summary.byDomain[domain] = (summary.byDomain[domain] ?? 0) + 1;
      }
      return summary;
    },
    async markRejected(userId: string, commandId: string, message: string): Promise<PendingCommand> {
      return this.update(userId, commandId, { state: 'conflict', failure: { kind: 'rejected', message }, reviewReason: 'The server explicitly rejected this command; it is retained and will not be retried automatically.' });
    },
    async acceptServerState(userId: string, commandId: string, evidence: ReadbackEvidence, acknowledged: boolean): Promise<PendingCommand> {
      if (acknowledged !== true) throw new Error('Explicit acknowledgement is required to accept authoritative server state.');
      let resolved: PendingCommand | undefined;
      await mutate(userId, envelope => {
        const index = envelope.commands.findIndex(item => item.commandId === commandId);
        if (index < 0) throw new Error(`Command '${commandId}' was not found.`);
        const command = envelope.commands[index];
        for (const domain of ['transactions', 'bills', 'anchors']) {
          const snapshot = evidence.byDomain[domain];
          if (!snapshot?.authoritative || !snapshot.complete) throw new Error('Complete authoritative readback of every finance domain is required to accept server state.');
        }
        for (const member of command.members) {
          const snapshot = evidence.byDomain[member.domain];
          if (!snapshot?.authoritative || !snapshot.complete) throw new Error('Complete authoritative readback is required for every command member.');
        }
        const domains = Object.fromEntries(Object.entries(evidence.byDomain).map(([domain, snapshot]) => [domain, {
          authoritative: true as const, complete: true as const, rowCount: snapshot!.rows.length,
        }]));
        const observedMembers = command.members.map(member => {
          const snapshot = evidence.byDomain[member.domain]!;
          return { domain: member.domain, rowId: member.rowId, row: snapshot.rows.find(item => item.id === member.rowId)?.row ?? null };
        });
        resolved = { ...command, resolution: { kind: 'accepted_server_state', at: new Date().toISOString(), acknowledged: true, evidence: { domains, observedMembers } }, updatedAt: new Date().toISOString(),
          reviewReason: 'User accepted complete authoritative server state; original command and evidence remain archived.' };
        envelope.commands[index] = resolved;
        return envelope;
      });
      return clone(resolved!);
    },
    async evaluateReadback(userId: string, commandId: string, evidence: ReadbackEvidence): Promise<{ outcome: 'confirmed' | 'retained'; command: PendingCommand }> {
      let result: { outcome: 'confirmed' | 'retained'; command: PendingCommand } | undefined;
      await mutate(userId, envelope => {
      const index = envelope.commands.findIndex(item => item.commandId === commandId);
      const command = envelope.commands[index];
      if (!command) throw new Error(`Command '${commandId}' was not found.`);
      if (command.failure?.kind === 'rejected') {
        result = { outcome: 'retained', command: clone(command) };
        return envelope;
      }
      if (command.kind === 'legacy') {
        const updated = { ...command, state: 'needs_review' as const,
          reviewReason: 'Legacy intent has no durable command payload or revision proof and requires explicit review.', updatedAt: new Date().toISOString() };
        envelope.commands[index] = updated;
        result = { outcome: 'retained', command: clone(updated) };
        return envelope;
      }
      const grouped = command.kind === 'reconcile' || command.kind === 'reconciliation' || command.members.length > 1;
      const matches: boolean[] = [];
      let unavailable = false;
      for (const member of command.members) {
        const snapshot = evidence.byDomain[member.domain];
        if (!snapshot?.authoritative || !snapshot.complete) { unavailable = true; continue; }
        const observed = snapshot.rows.find(item => item.id === member.rowId)?.row;
        matches.push(member.desired === null ? observed === undefined : observed !== undefined && rowMatches(observed, member.desired));
      }
      let state: PendingState = 'pending';
      let reviewReason: string | undefined;
      if (unavailable || matches.length !== command.members.length) {
        state = 'needs_review';
        reviewReason = 'Complete authoritative readback is not available for every command member.';
      } else if (matches.some(matched => !matched)) {
        state = 'conflict';
        reviewReason = 'Authoritative readback differs from the command intent.';
      } else if (grouped && !evidence.completeCommandIds?.includes(commandId)) {
        state = 'needs_review';
        reviewReason = 'Rows match, but the caller did not provide authoritative evidence for the complete atomic command.';
      } else {
        envelope.commands.splice(index, 1);
        result = { outcome: 'confirmed', command: clone(command) };
        return envelope;
      }
      const updated = { ...command, state, reviewReason, updatedAt: new Date().toISOString() };
      envelope.commands[index] = updated;
      result = { outcome: 'retained', command: clone(updated) };
      return envelope;
      });
      return result!;
    },
  };
}
