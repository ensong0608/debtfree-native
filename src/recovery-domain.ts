import type { HouseholdContext, HouseholdMembershipSummary } from './household-context';
export type DebtCategoryDiagnostic = { id: string; name: string; issue: string; version: number | string | undefined; category: string | null };
export function categoryDiagnostics(rows: Array<{ id: string; name: string; category: string | null; version?: number | string }>, validate: (category: string | null) => unknown): DebtCategoryDiagnostic[] {
  return rows.flatMap(row => {
    try { validate(row.category); return []; }
    catch { return [{ id: row.id, name: row.name, issue: row.category == null || row.category === '' ? 'Missing category' : 'Unsupported category', version: row.version, category: row.category }]; }
  });
}
export function recoveryFailure(verified: boolean, context: HouseholdContext | null, summaries: HouseholdMembershipSummary[], diagnostics: DebtCategoryDiagnostic[]) {
  return verified ? { route: 'recovery' as const, context, summaries, diagnostics } : { route: 'unavailable' as const, context: null, summaries: [], diagnostics: [] };
}

/** Invitation entry must also work before a new user has any household. */
export async function resolveRecoverySourceContext(
  userId: string,
  known: HouseholdContext | null,
  listMemberships: () => Promise<HouseholdMembershipSummary[]>,
  selectCurrent: () => Promise<HouseholdContext>,
): Promise<HouseholdContext | null> {
  if (known?.userId === userId) return known;
  const memberships = await listMemberships();
  if (memberships.length === 0) return null;
  return selectCurrent();
}
