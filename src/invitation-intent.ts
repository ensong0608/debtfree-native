import type { KeyValueStore } from './secure-chunks';

export type InvitationIntent = {
  version: 1;
  token: string;
  userId: string | null;
  acceptedHouseholdId: string | null;
};

const KEY = 'debtfree-pending-invitation-v1';

export function decodeInvitationIntent(raw: string | null): InvitationIntent | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as InvitationIntent;
  if (item.version !== 1 || typeof item.token !== 'string' || item.token.length < 32 || item.token.length > 128 || /\s/.test(item.token)
      || !(item.userId === null || typeof item.userId === 'string' && item.userId.length > 0)
      || !(item.acceptedHouseholdId === null || typeof item.acceptedHouseholdId === 'string' && item.acceptedHouseholdId.length > 0)
      || item.acceptedHouseholdId !== null && item.userId === null) return null;
  return { version: 1, token: item.token, userId: item.userId, acceptedHouseholdId: item.acceptedHouseholdId };
}

export function invitationForUser(intent: InvitationIntent | null, userId: string): InvitationIntent | null {
  return intent && (intent.userId === null || intent.userId === userId) ? intent : null;
}

/** Storage is encrypted by the native adapter. Serialize writes so links cannot race receipts. */
export function createInvitationIntentStore(storage: KeyValueStore) {
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
  return {
    load: () => serialize(async () => decodeInvitationIntent(await storage.getItem(KEY))),
    receive: (token: string) => serialize(async () => {
      const current = decodeInvitationIntent(await storage.getItem(KEY));
      if (current?.token === token) return current;
      const incoming = decodeInvitationIntent(JSON.stringify({ version: 1, token, userId: null, acceptedHouseholdId: null }));
      if (!incoming) throw new Error('Invitation could not be saved safely.');
      await storage.setItem(KEY, JSON.stringify(incoming));
      return incoming;
    }),
    bind: (userId: string, token: string) => serialize(async () => {
      const current = decodeInvitationIntent(await storage.getItem(KEY));
      if (current && current.token !== token) throw new Error('A newer invitation was opened. Continue with that invitation.');
      if (current?.userId && current.userId !== userId) throw new Error('This saved invitation belongs to another signed-in account. Use the invited account.');
      const bound = decodeInvitationIntent(JSON.stringify(current ? { ...current, userId } : {
        version: 1, token, userId, acceptedHouseholdId: null,
      }));
      if (!bound) throw new Error('Invitation could not be saved safely.');
      await storage.setItem(KEY, JSON.stringify(bound));
      return bound;
    }),
    save: (intent: InvitationIntent) => serialize(async () => {
      const validated = decodeInvitationIntent(JSON.stringify(intent));
      if (!validated) throw new Error('Invitation could not be saved safely.');
      await storage.setItem(KEY, JSON.stringify(validated));
      return validated!;
    }),
    update: (expected: InvitationIntent, next: InvitationIntent) => serialize(async () => {
      const current = decodeInvitationIntent(await storage.getItem(KEY));
      if (current?.token !== expected.token || current.userId !== expected.userId) return false;
      const validated = decodeInvitationIntent(JSON.stringify(next));
      if (!validated) throw new Error('Invitation receipt could not be saved safely.');
      await storage.setItem(KEY, JSON.stringify(validated));
      return true;
    }),
    // An older request must never erase a newly received invitation.
    clear: (expected: InvitationIntent) => serialize(async () => {
      const current = decodeInvitationIntent(await storage.getItem(KEY));
      if (current?.token !== expected.token || current.userId !== expected.userId) return false;
      await storage.removeItem(KEY);
      return true;
    }),
  };
}

/** Persist acceptance separately from opening; a confirmed join is never dispatched twice. */
export async function joinHouseholdWithRecovery<T>(options: {
  userId: string;
  token: string;
  store: ReturnType<typeof createInvitationIntentStore>;
  accept: () => Promise<{ userId: string; householdId: string }>;
  open: (householdId: string) => Promise<T>;
  onIntent?: (intent: InvitationIntent) => void;
}): Promise<{ result: T; intent: InvitationIntent }> {
  const { userId, token, store } = options;
  let intent = await store.bind(userId, token);
  options.onIntent?.(intent);
  if (!intent.acceptedHouseholdId) {
    const accepted = await options.accept();
    if (accepted.userId !== userId || !accepted.householdId) throw new Error('Invitation acceptance did not match the signed-in account.');
    const receipt = { ...intent, acceptedHouseholdId: accepted.householdId };
    if (!await store.update(intent, receipt)) throw new Error('A newer invitation was opened. Continue with that invitation.');
    intent = receipt;
    options.onIntent?.(intent);
  }
  // The open operation MUST revalidate exact current membership and pending writes.
  const result = await options.open(intent.acceptedHouseholdId!);
  return { result, intent };
}

export class StartupTimeoutError extends Error {
  constructor() {
    super('Connecting is taking longer than expected. Check your connection and try again. Your saved account and data are still on this device.');
    this.name = 'StartupTimeoutError';
  }
}

/** Only bounds reads/UI waiting. Callers must invalidate late results; never retry a timed-out write blindly. */
export async function withStartupDeadline<T>(operation: Promise<T>, milliseconds = 25000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StartupTimeoutError()), milliseconds);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
