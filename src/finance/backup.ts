// Native recovery contract. No storage or network writes occur except through the injected checkpoint store.
// @ts-ignore TS5097
import type { UserOnboardingData } from '../onboarding-domain.ts';
// @ts-ignore TS5097
import { getCurrency } from './currencies.ts';
// @ts-ignore TS5097
import { makeMoney, parseMoney, type Money } from './money.ts';
// @ts-ignore TS5097
import { parseDateOnly } from './calendar.ts';
// @ts-ignore TS5097
import { validateLedgerTransaction, type LedgerTransaction, type ReconciliationAnchor } from './ledger.ts';
// @ts-ignore TS5097
import { encodeRecurringBillRow, decodeRecurringBillRow } from './storage-domain.ts';
// @ts-ignore TS5097
import type { RecurringBill } from './recurring-bills.ts';
// @ts-ignore TS5097
import { validateObligationSchedule } from './obligation-schedule.ts';
// @ts-ignore TS5097
import type { KeyValueStore } from './pending-journal.ts';

export type BackupOwner = { userId: string; householdId: string };
export type NativeBackup = { schema: 'debtfree-native-backup'; version: 1; userId: string; householdId: string; currency: string; exportedAt: string; onboardingData: UserOnboardingData; transactions: LedgerTransaction[]; recurringBills: RecurringBill[]; reconciliationAnchors: ReconciliationAnchor[] };
export type RestoreDomain = 'onboardingData' | 'debts' | 'recurringBills' | 'transactions' | 'reconciliationAnchors';
export type RestoreOperation = { domain: RestoreDomain; id: string; action: 'create' | 'unchanged' | 'conflict'; incoming: unknown; current?: unknown };
export type RestorePlan = { operations: RestoreOperation[]; conflicts: number };
export type RestoreCheckpoint = { version: 1; owner: BackupOwner; before: NativeBackup; incoming: NativeBackup; plan: RestorePlan; status: 'in_progress' | 'failed' | 'completed'; cursor: number; operationId?: string; baselineToken?: string; payloadFingerprint?: string; resolutionMode?: 'merge' | 'replace'; acceptedConflictIds?: string[]; keptCurrentConflictIds?: string[]; error?: string };
const MAX_ROWS = 100000;
function fail(message: string): never { throw new TypeError(message); }
function object(v: unknown, name: string): asserts v is Record<string, any> { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`Invalid ${name}`); }
function id(v: unknown, name: string): asserts v is string { if (typeof v !== 'string' || !v.trim() || v !== v.trim() || v.length > 512) fail(`Invalid ${name}`); }
function timestamp(v: unknown, name: string) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) fail(`Invalid ${name}`); parseDateOnly(v.slice(0, 10)); }
function choice(v: unknown, values: readonly unknown[], name: string) { if (!values.includes(v)) fail(`Invalid ${name}`); }
function bool(v: unknown, name: string) { if (typeof v !== 'boolean') fail(`Invalid ${name}`); }
function rows(v: unknown, name: string): asserts v is any[] { if (!Array.isArray(v) || v.length > MAX_ROWS) fail(`Missing or invalid ${name} domain`); }
function unique(items: any[], name: string) { const seen = new Set(); for (const item of items) { object(item, name); id(item.id, `${name} id`); if (seen.has(item.id)) fail(`Duplicate ${name} id: ${item.id}`); seen.add(item.id); } return seen as Set<string>; }
function money(v: Money, currency: string, signed = false) { object(v, 'money'); makeMoney(v.currency, v.minorUnits); if (v.currency !== currency) fail('Mixed currency in backup'); if (!signed && v.minorUnits < 0) fail('Negative money'); }
function major(v: unknown, currency: string, signed = false) { if (typeof v !== 'number' || !Number.isFinite(v)) fail('Invalid monetary amount'); parseMoney(String(v), currency, signed); }
function copy<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

/** Throws on incomplete, foreign, malformed, or internally inconsistent native snapshots. */
export function validateNativeBackup(value: unknown, owner: BackupOwner): asserts value is NativeBackup {
  object(value, 'backup'); id(owner.userId, 'authenticated user'); id(owner.householdId, 'authenticated household');
  if (value.schema !== 'debtfree-native-backup' || value.version !== 1) fail('Unsupported native backup schema or version');
  if (value.userId !== owner.userId || value.householdId !== owner.householdId) fail('Backup belongs to a different user or household');
  id(value.currency, 'currency'); getCurrency(value.currency); timestamp(value.exportedAt, 'exportedAt');
  const d = value.onboardingData; object(d, 'onboardingData');
  if (d.version !== 1 || d.userId !== owner.userId || d.householdId !== owner.householdId) fail('Onboarding data belongs to a different user or household');
  if ((d.currencyCode ?? ({US:'USD', CA:'CAD', GB:'GBP', AU:'AUD'} as Record<string,string>)[d.countryCode]) !== value.currency) fail('Onboarding currency mismatch');
  choice(d.currentStage, ['welcome','signup_1','signup_2','signup_3','signup_4','onboard_1','onboard_2','onboard_3','onboard_4','onboard_5','home'], 'stage');
  choice(d.countryCode, ['US','CA','GB','AU'], 'country'); choice(d.primaryPayFrequency, ['biweekly','monthly','weekly','twice_monthly'], 'frequency'); choice(d.selectedPlan, ['premium','premium_bank_sync'], 'plan'); choice(d.homeStatus, ['Own','Rent','Other'], 'home status'); choice(d.vehicleStatus, ['Finance','Lease','Own','None'], 'vehicle status'); choice(d.strategy, ['snowball','avalanche'], 'strategy'); choice(d.consideredBeforeAi, ['yes','no',null], 'referral answer');
  for (const k of ['signupCompleted','onboardingCompleted']) bool(d[k], k);
  for (const k of ['managesWithPartner','worksWithProfessional']) choice(d[k], [true,false,null], k);
  if (typeof d.referralSource !== 'string') fail('Invalid referral source'); rows(d.goals, 'goals'); if (d.goals.some((x: unknown) => typeof x !== 'string')) fail('Invalid goals');
  for (const k of ['primaryIncomeAmount','primaryMonthlyIncome','extraMonthlyPayment']) major(d[k], value.currency);
  rows(d.additionalIncomes, 'additionalIncomes'); unique(d.additionalIncomes, 'income'); for (const x of d.additionalIncomes) { id(x.name, 'income name'); major(x.amount, value.currency); major(x.monthlyAmount, value.currency); choice(x.frequency, ['biweekly','monthly','weekly','twice_monthly'], 'income frequency'); }
  object(d.notifications, 'notifications'); for (const k of ['upcomingReminders','overdueAlerts','milestonesAndProgress','permissionRequested']) bool(d.notifications[k], k); choice(d.notifications.osPermissionStatus, ['undetermined','granted','denied','unavailable'], 'permission status');
  timestamp(d.updatedAt, 'onboarding updatedAt'); if (d.completedAt !== null) timestamp(d.completedAt, 'completedAt');
  if (d.householdTimeZone !== undefined) { try { new Intl.DateTimeFormat('en', {timeZone:d.householdTimeZone}); } catch { fail('Invalid household time zone'); } }
  rows(d.debts, 'debts'); rows(value.transactions, 'transactions'); rows(value.recurringBills, 'recurringBills'); rows(value.reconciliationAnchors, 'reconciliationAnchors');
  const debts = unique(d.debts, 'debt'), txs = unique(value.transactions, 'transaction'); unique(value.recurringBills, 'bill'); unique(value.reconciliationAnchors, 'anchor');
  if (d.loanBillPairingByDebtId !== undefined) {
    object(d.loanBillPairingByDebtId, 'loan bill pairings');
    if (Object.keys(d.loanBillPairingByDebtId).length > MAX_ROWS) fail('Too many loan bill pairings');
    const pairedBillIds = new Set<string>();
    for (const [debtId, relation] of Object.entries(d.loanBillPairingByDebtId)) {
      id(debtId, 'paired debt ID');
      object(relation, 'loan bill pairing');
      choice(relation.status, ['linked','separate','dismissed'], 'loan bill pairing status');
      if (relation.status === 'linked') {
        id(relation.billId, 'paired bill ID');
        if (pairedBillIds.has(relation.billId)) fail('Recurring bill is paired with multiple loans');
        pairedBillIds.add(relation.billId);
        // A confirmed lifecycle mutation and its separate settings CAS are not atomic.
        // Keep structurally valid stale links in backup/checkpoints so cleanup failures
        // remain recoverable; activeLoanBillLinks ignores missing or incompatible targets.
      } else if (relation.billId !== undefined) fail('Only linked loan pairings may contain a bill ID');
    }
  }
  if (d.recurringBillCategoryLabelByBillId !== undefined) {
    object(d.recurringBillCategoryLabelByBillId, 'recurring bill custom category labels');
    if (Object.keys(d.recurringBillCategoryLabelByBillId).length > MAX_ROWS) fail('Too many recurring bill custom category labels');
    for (const [billId, label] of Object.entries(d.recurringBillCategoryLabelByBillId)) {
      id(billId, 'custom category bill ID');
      if (typeof label !== 'string' || !label.trim() || label.trim() !== label || label.length > 40) fail('Invalid recurring bill custom category label');
    }
  }
  for (const x of d.debts) { id(x.name, 'debt name'); choice(x.category, ['Mortgage','Auto loan','Credit card','Personal loan','Student loan','Medical debt','Other loan'], 'debt category'); major(x.balance,value.currency,true); major(x.minimumPayment,value.currency); for (const k of ['originalBalance','creditLimit']) if (x[k] !== null) major(x[k],value.currency); if (typeof x.apr !== 'number' || !Number.isFinite(x.apr) || x.apr < 0) fail('Invalid APR'); if (x.dueDay !== null && (!Number.isInteger(x.dueDay) || x.dueDay < 1 || x.dueDay > 31)) fail('Invalid debt due day'); timestamp(x.createdAt,'debt createdAt'); timestamp(x.updatedAt,'debt updatedAt'); if (x.serverVersion !== undefined && (!Number.isSafeInteger(x.serverVersion) || x.serverVersion < 0)) fail('Invalid debt revision'); }
  for (const x of value.transactions) { validateLedgerTransaction(x); money(x.amount,value.currency); for (const k of ['principalAmount','interestAmount','escrowAmount','feeAmount']) if (x[k] != null) money(x[k],value.currency); choice(x.source,['manual','recurring_bill','reconciliation','system'],'transaction source'); if (x.accountId !== null) id(x.accountId,'transaction account ID'); if (x.appliesToDate != null) parseDateOnly(x.appliesToDate); if (typeof x.payee !== 'string' || (x.memo !== undefined && typeof x.memo !== 'string')) fail('Invalid transaction text'); bool(x.reconciled,'reconciled'); if (x.isPending !== undefined) bool(x.isPending,'isPending'); timestamp(x.createdAt,'transaction createdAt'); if (x.updatedAt !== undefined) timestamp(x.updatedAt,'updatedAt'); if (x.deletedAt !== null) timestamp(x.deletedAt,'transaction deletedAt'); }
  for (const x of value.recurringBills) { id(x.name,'bill name'); money(x.amount,value.currency); choice(x.category,['utilities','subscription','housing','insurance','other_bill'],'bill category'); choice(x.paymentMethod,['debit','credit'],'payment method'); if (!Number.isInteger(x.dueDay) || x.dueDay < 1 || x.dueDay > 31) fail('Invalid bill due day'); bool(x.autoPost,'autoPost'); bool(x.active,'active'); timestamp(x.createdAt,'bill createdAt'); if (x.paymentMethod === 'credit') id(x.creditAccountId,'bill account ID'); if (x.paymentMethod === 'debit' && x.creditAccountId != null) fail('Debit bill has credit account'); decodeRecurringBillRow(encodeRecurringBillRow(x,owner.userId,owner.householdId),value.currency); }
  for (const x of value.reconciliationAnchors) { id(x.accountId,'anchor account ID'); parseDateOnly(x.asOfDate); money(x.verifiedBalance,value.currency,true); timestamp(x.createdAt,'anchor createdAt'); if (x.note !== undefined && typeof x.note !== 'string') fail('Invalid anchor note'); if (x.createdAdjustmentId != null && (!txs.has(x.createdAdjustmentId) || !value.transactions.some(t => t.id === x.createdAdjustmentId && t.accountId === x.accountId))) fail('Orphan anchor adjustment'); if (x.coveredTransactionIds !== undefined) { rows(x.coveredTransactionIds,'covered transaction ids'); const seen = new Set(); for (const t of x.coveredTransactionIds) { if (seen.has(t) || !txs.has(t) || !value.transactions.some(y => y.id === t && y.accountId === x.accountId)) fail('Invalid anchor transaction reference'); seen.add(t); } } }
  if (d.obligationSchedules !== undefined) { object(d.obligationSchedules,'obligation schedules'); if (Object.keys(d.obligationSchedules).length > MAX_ROWS) fail('Too many schedules'); for (const [key,s] of Object.entries(d.obligationSchedules)) { const p = key.indexOf(':'); const kind = key.slice(0,p), target = key.slice(p+1); if (p < 1 || !(kind === 'debt' || kind === 'bill')) fail('Invalid obligation schedule key'); id(target,'obligation schedule target'); validateObligationSchedule(s as any); for (const term of (s as any).terms) money(term.amount,value.currency); } }
}
export function createNativeBackup(input: Omit<NativeBackup,'schema'|'version'>, owner: BackupOwner): NativeBackup { const result = { schema:'debtfree-native-backup' as const, version:1 as const, ...copy(input) }; validateNativeBackup(result,owner); return result; }
/** Report stale pairing metadata without discarding it from export or recovery. */
export function nativeBackupLifecycleWarnings(value: Pick<NativeBackup, 'onboardingData' | 'transactions' | 'recurringBills' | 'reconciliationAnchors'>): string[] {
  const pairings = value.onboardingData.loanBillPairingByDebtId ?? {};
  const debts = value.onboardingData.debts;
  const bills = value.recurringBills;
  const stalePairing = Object.entries(pairings).some(([debtId, relation]) => {
    if (relation?.status !== 'linked') return !debts.some(debt => debt.id === debtId);
    const debt = debts.find(candidate => candidate.id === debtId);
    const bill = bills.find(candidate => candidate.id === relation.billId);
    return !debt || !bill || !bill.active || bill.paymentMethod !== 'debit' ||
      (debt.category === 'Mortgage' ? !['housing', 'other_bill'].includes(bill.category) :
        debt.category === 'Auto loan' ? bill.category !== 'other_bill' : true);
  });
  const debtIds = new Set(debts.map(debt => debt.id));
  const billIds = new Set(bills.map(bill => bill.id));
  const staleSchedule = Object.entries(value.onboardingData.obligationSchedules ?? {}).some(([key]) => {
    const split = key.indexOf(':');
    return split < 1 || (key.slice(0, split) === 'debt' ? !debtIds.has(key.slice(split + 1)) :
      key.slice(0, split) === 'bill' ? !billIds.has(key.slice(split + 1)) : true);
  });
  const staleAccount = value.transactions.some(tx => tx.accountId !== null && !debtIds.has(tx.accountId)) ||
    value.recurringBills.some(bill => bill.paymentMethod === 'credit' && Boolean(bill.creditAccountId) && !debtIds.has(bill.creditAccountId!)) ||
    value.reconciliationAnchors.some(anchor => !debtIds.has(anchor.accountId));
  const staleCategoryLabel = Object.keys(value.onboardingData.recurringBillCategoryLabelByBillId ?? {}).some(id => !billIds.has(id));
  return stalePairing || staleSchedule || staleAccount || staleCategoryLabel
    ? ['One or more records retain references to accounts or bills removed by confirmed lifecycle changes. Metadata was preserved in this backup for recovery; stale pairings, category labels, and schedules are ignored for active commitments.']
    : [];
}
/** Unknown or incomplete formats throw an actionable error; prototype payloads are never converted. */
export function parseNativeBackup(raw: string, owner: BackupOwner): { backup: NativeBackup; warnings: string[] } {
  let v: any; try { v = JSON.parse(raw); } catch { return fail('Invalid backup JSON'); }
  object(v,'backup'); const warnings: string[] = [];
  if (v.schema === 'debtfree-sandbox-snapshot-v1') { object(v.onboardingData,'onboardingData'); const d = v.onboardingData; v = { ...v, schema:'debtfree-native-backup', version:1, userId:d.userId, householdId:d.householdId, currency:d.currencyCode ?? ({US:'USD', CA:'CAD', GB:'GBP', AU:'AUD'} as Record<string,string>)[d.countryCode] }; warnings.push('Legacy native developer export; review before recovery.'); }
  else if (v.schema !== 'debtfree-native-backup' || v.version !== 1) fail('Unsupported backup payload or version; native recovery does not import prototype data');
  validateNativeBackup(v,owner); warnings.push(...nativeBackupLifecycleWarnings(v)); return { backup:copy(v), warnings };
}
function canonical(v: any): string { if (v === null || typeof v !== 'object') return JSON.stringify(v); if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`; return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`; }
/** A conflict requires explicit caller resolution; no overwrite or deletion is implied. */
export function createRestorePlan(incoming: NativeBackup, current: NativeBackup, owner: BackupOwner): RestorePlan {
  validateNativeBackup(incoming,owner); validateNativeBackup(current,owner); if (incoming.currency !== current.currency) fail('Backup currency differs from current household');
  const ops: RestoreOperation[] = [];
  const add = (domain: RestoreDomain, key: string, next: unknown, previous?: unknown) => { const action = previous === undefined ? 'create' : canonical(next) === canonical(previous) ? 'unchanged' : 'conflict'; ops.push({domain,id:key,action,incoming:copy(next),...(previous === undefined ? {} : {current:copy(previous)})}); };
  const { debts: incomingDebts, ...incomingSettings } = incoming.onboardingData; const { debts: currentDebts, ...currentSettings } = current.onboardingData;
  add('onboardingData',owner.userId,incomingSettings,currentSettings);
  for (const [domain, a, b] of [['debts',incomingDebts,currentDebts],['recurringBills',incoming.recurringBills,current.recurringBills],['transactions',incoming.transactions,current.transactions],['reconciliationAnchors',incoming.reconciliationAnchors,current.reconciliationAnchors]] as const) { const map = new Map(b.map(x => [x.id,x])); for (const row of [...a].sort((x,y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0)) add(domain,row.id,row,map.get(row.id)); }
  return { operations:ops, conflicts:ops.filter(x => x.action === 'conflict').length };
}
/** One durable envelope per owner. Serialize calls through one repository instance. */
export function createBackupCheckpointRepository(store: KeyValueStore, options: { key?: (owner: BackupOwner) => string } = {}) {
  const key = options.key ?? ((o: BackupOwner) => `finance-backup-checkpoint:${encodeURIComponent(o.userId)}:${encodeURIComponent(o.householdId)}`); let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = queue.then(fn,fn); queue = p.catch(() => undefined); return p; };
  const read = async (owner: BackupOwner): Promise<RestoreCheckpoint | null> => { const raw = await store.getItem(key(owner)); if (raw === null) return null; let c: RestoreCheckpoint; try { c = JSON.parse(raw); } catch { return fail('Invalid checkpoint JSON'); } object(c,'checkpoint'); if (c.version !== 1 || c.owner?.userId !== owner.userId || c.owner?.householdId !== owner.householdId) fail('Invalid checkpoint owner or version'); if (c.operationId !== undefined) id(c.operationId,'restore operation ID'); if (c.baselineToken !== undefined) id(c.baselineToken,'restore baseline token'); if (c.payloadFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(c.payloadFingerprint)) fail('Invalid restore payload fingerprint'); if (c.resolutionMode !== undefined) choice(c.resolutionMode,['merge','replace'],'restore resolution mode'); if (c.acceptedConflictIds !== undefined && (!Array.isArray(c.acceptedConflictIds) || c.acceptedConflictIds.some((value) => typeof value !== 'string'))) fail('Invalid accepted conflict IDs'); if (c.keptCurrentConflictIds !== undefined && (!Array.isArray(c.keptCurrentConflictIds) || c.keptCurrentConflictIds.some((value) => typeof value !== 'string'))) fail('Invalid kept conflict IDs'); validateNativeBackup(c.before,owner); validateNativeBackup(c.incoming,owner); const expected = createRestorePlan(c.incoming,c.before,owner); if (canonical(c.plan) !== canonical(expected)) fail('Invalid checkpoint plan'); choice(c.status,['in_progress','failed','completed'],'checkpoint status'); if (!Number.isSafeInteger(c.cursor) || c.cursor < 0 || c.cursor > c.plan.operations.length || (c.status === 'completed' && c.cursor !== c.plan.operations.length)) fail('Invalid checkpoint cursor'); if (c.error !== undefined && typeof c.error !== 'string') fail('Invalid checkpoint error'); return c; };
  return {
    load: (owner: BackupOwner) => serial(() => read(owner)),
    begin: (owner: BackupOwner, before: NativeBackup, incoming: NativeBackup, options: { acknowledgeReplacement?: boolean; operationId?: string; baselineToken?: string; payloadFingerprint?: string; resolutionMode?: 'merge' | 'replace'; acceptedConflictIds?: string[]; keptCurrentConflictIds?: string[] } = {}) => serial(async () => { const existing = await read(owner); if (existing && existing.status !== 'completed' && options.acknowledgeReplacement !== true) fail('Active or failed restore checkpoint requires explicit replacement acknowledgement'); if (options.operationId !== undefined) id(options.operationId,'restore operation ID'); if (options.baselineToken !== undefined) id(options.baselineToken,'restore baseline token'); if (options.payloadFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(options.payloadFingerprint)) fail('Invalid restore payload fingerprint'); if (options.resolutionMode !== undefined) choice(options.resolutionMode,['merge','replace'],'restore resolution mode'); if (options.acceptedConflictIds !== undefined && (!Array.isArray(options.acceptedConflictIds) || options.acceptedConflictIds.some((value) => typeof value !== 'string'))) fail('Invalid accepted conflict IDs'); if (options.keptCurrentConflictIds !== undefined && (!Array.isArray(options.keptCurrentConflictIds) || options.keptCurrentConflictIds.some((value) => typeof value !== 'string'))) fail('Invalid kept conflict IDs'); const plan = createRestorePlan(incoming,before,owner); const c: RestoreCheckpoint = {version:1,owner:copy(owner),before:copy(before),incoming:copy(incoming),plan,status:'in_progress',cursor:0,...(options.operationId ? {operationId:options.operationId} : {}),...(options.baselineToken ? {baselineToken:options.baselineToken} : {}),...(options.payloadFingerprint ? {payloadFingerprint:options.payloadFingerprint} : {}),...(options.resolutionMode ? {resolutionMode:options.resolutionMode} : {}),...(options.acceptedConflictIds ? {acceptedConflictIds:copy(options.acceptedConflictIds)} : {}),...(options.keptCurrentConflictIds ? {keptCurrentConflictIds:copy(options.keptCurrentConflictIds)} : {})}; await store.setItem(key(owner),JSON.stringify(c)); return copy(c); }),
    update: (owner: BackupOwner, progress: { status: RestoreCheckpoint['status']; cursor: number; error?: string }) => serial(async () => { const c = await read(owner); if (!c) return fail('No restore checkpoint'); if (c.status === 'completed') fail('Completed checkpoint cannot be updated'); if (!Number.isSafeInteger(progress.cursor) || progress.cursor < c.cursor || progress.cursor > c.plan.operations.length || (progress.status === 'completed' && progress.cursor !== c.plan.operations.length)) fail('Invalid checkpoint progress'); choice(progress.status,['in_progress','failed','completed'],'checkpoint status'); if (progress.error !== undefined && typeof progress.error !== 'string') fail('Invalid checkpoint error'); const next = {...c,...progress}; if (progress.error === undefined) delete next.error; await store.setItem(key(owner),JSON.stringify(next)); return copy(next); }),
  };
}
