import type { Session } from '@supabase/supabase-js';
import type { HouseholdContext, HouseholdMembershipSummary } from './household-context';
import type { SessionVerification } from './identity-verification';

export type RepairDiagnostic = { id: string; name: string; issue: string; version: number | string | undefined; category: string | null };
export type RepairCategory = 'Credit card' | 'Personal loan' | 'Auto loan' | 'Student loan' | 'Medical debt' | 'Other loan' | 'Mortgage';
export const REPAIR_CATEGORIES: readonly RepairCategory[] = [
  'Credit card', 'Personal loan', 'Auto loan', 'Student loan', 'Medical debt', 'Other loan', 'Mortgage',
];

type DebtRow = { id: string; household_id: string | null; category: string | null; version: number | string; annual_fee_amount: number | string | null };
type RepairClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};
export type CategoryRepairDependencies = {
  getClient: () => RepairClient;
  createSessionVerification: (session: Session) => SessionVerification;
  listVerifiedHouseholdContexts: (session: Session, verification: SessionVerification) => Promise<HouseholdMembershipSummary[]>;
  getPendingFinanceSummary: (context: HouseholdContext) => Promise<{ total: number }>;
};

export class CategoryRepairUncertainError extends Error {
  constructor() {
    super('We could not confirm this category save. Refresh to check the latest account information before trying again.');
    this.name = 'CategoryRepairUncertainError';
  }
}

function versionText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) return String(value);
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) return value;
  return null;
}

function incrementDecimal(value: string): string {
  const digits = value.split('');
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    if (digits[i] !== '9') { digits[i] = String(Number(digits[i]) + 1); return digits.join(''); }
    digits[i] = '0';
  }
  return `1${digits.join('')}`;
}

function record(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (Array.isArray(value) && value.length === 1) return record(value[0]);
  return null;
}

function supported(category: unknown): category is RepairCategory {
  return typeof category === 'string' && REPAIR_CATEGORIES.includes(category as RepairCategory);
}

function knownRejection(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error?.code && ['22023', '23514', '40001', '42501', '28000', 'P0001'].includes(error.code));
}

export async function repairDebtCategory(
  input: { session: Session; context: HouseholdContext; diagnostic: RepairDiagnostic; category: RepairCategory },
  deps: CategoryRepairDependencies,
): Promise<{ category: RepairCategory; version: string }> {
  const { session, context, diagnostic, category } = input;
  const expectedVersion = versionText(diagnostic.version);
  if (!session?.user?.id || context.userId !== session.user.id) throw new Error('The signed-in household could not be verified. No change was made.');
  if (!expectedVersion) throw new Error('This account has an invalid revision. Refresh the recovery screen before saving.');
  if (!REPAIR_CATEGORIES.includes(category)) throw new Error('Choose a supported account category.');
  if (context.role !== 'owner' && context.role !== 'member') throw new Error('This household is read-only for your account.');
  if (diagnostic.category && supported(diagnostic.category)) throw new Error('This account already has a supported category. Refresh the recovery screen.');

  const client = deps.getClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || authData.user?.id !== session.user.id) throw new Error('Your signed-in account could not be verified. No change was made.');
  const verification = deps.createSessionVerification(session);
  const memberships = await deps.listVerifiedHouseholdContexts(session, verification);
  const current = memberships.find(summary => summary.householdId === context.householdId);
  if (!current || current.userId !== context.userId || current.role !== context.role || current.membershipVersion !== context.membershipVersion) {
    throw new Error('This household membership changed. Refresh the recovery screen before saving.');
  }

  const pending = await deps.getPendingFinanceSummary(context);
  if (!pending || !Number.isSafeInteger(pending.total) || pending.total < 0) throw new Error('Pending account changes could not be verified. No category was changed.');
  if (pending.total > 0) throw new Error('Finish or resolve this household’s pending account changes before repairing a category.');

  const readTarget = async (): Promise<DebtRow | null> => {
    const result = await client.from('debts')
      .select('id,household_id,category,version,annual_fee_amount')
      .eq('id', diagnostic.id)
      .eq('household_id', context.householdId)
      .maybeSingle();
    if (result.error) throw new Error('The account could not be rechecked. No category change was confirmed.');
    return result.data && typeof result.data === 'object' ? result.data as DebtRow : null;
  };

  const before = await readTarget();
  if (!before || before.id !== diagnostic.id || before.household_id !== context.householdId) throw new Error('This account is no longer in the selected household. No change was made.');
  if (versionText(before.version) !== expectedVersion || before.category !== diagnostic.category) throw new Error('This account changed since it was diagnosed. Refresh before saving.');
  if (supported(before.category)) throw new Error('This account already has a supported category. Refresh the recovery screen.');
  if (before.annual_fee_amount != null && category !== 'Credit card') throw new Error('An account with an annual fee must use Credit card.');

  const pendingAgain = await deps.getPendingFinanceSummary(context);
  if (!pendingAgain || !Number.isSafeInteger(pendingAgain.total) || pendingAgain.total < 0) throw new Error('Pending account changes could not be verified. No category was changed.');
  if (pendingAgain.total > 0) throw new Error('Finish or resolve this household’s pending account changes before repairing a category.');

  const args = {
    p_household_id: context.householdId,
    p_expected_membership_version: context.membershipVersion,
    p_debt_id: diagnostic.id,
    p_expected_debt_version: expectedVersion,
    p_category: category,
  };
  const result = await client.rpc('debtfree_repair_debt_category', args);
  if (result.error && knownRejection(result.error)) throw new Error(result.error.message || 'The account could not be repaired. Refresh and try again.');

  const confirmedVersion = incrementDecimal(expectedVersion);
  const confirms = (value: unknown) => {
    const receipt = record(value);
    return receipt?.success === true
      && receipt.householdId === context.householdId
      && receipt.debtId === diagnostic.id
      && receipt.category === category
      && versionText(receipt.version) === confirmedVersion
      && String(receipt.membershipVersion ?? '') === context.membershipVersion;
  };
  if (!result.error && confirms(result.data)) return { category, version: confirmedVersion };

  let readback: DebtRow | null = null;
  try { readback = await readTarget(); } catch { /* preserve the uncertain outcome below */ }
  if (readback && readback.id === diagnostic.id && readback.household_id === context.householdId
      && readback.category === category && versionText(readback.version) === confirmedVersion) {
    return { category, version: confirmedVersion };
  }
  throw new CategoryRepairUncertainError();
}
