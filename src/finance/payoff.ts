// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { makeMoney, addMoney, multiplyMoneyRatio, type Money } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { monthlyPaymentDate, householdDate, type DateOnly } from './calendar.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import type { AccountId, Availability, ProjectionAssumptions } from './contracts.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { getCurrency } from './currencies.ts';

export type PayoffStrategy = 'snowball' | 'avalanche';
export type PayoffAccountInput = Readonly<{ accountId: AccountId; inclusion: 'accelerated' | 'minimum-only' | 'excluded'; balance: Money; aprThousandths: number | null; scheduledMinimum: Money | null }>;
export type PayoffInput = Readonly<{ accounts: Availability<readonly PayoffAccountInput[]>; assumptions: ProjectionAssumptions; strategy: PayoffStrategy; currency: string; extraMonthlyPayment: Money; fixedMonthlyCommitment?: Money; maxHorizonMonths?: number }>;
export type RankableAccount = Readonly<{ accountId: AccountId; openingObligation: Money; aprThousandths: number }>;
export function rankAcceleratedAccounts<T extends RankableAccount>(accounts: readonly T[], strategy: PayoffStrategy): T[] {
  return [...accounts].sort((a, b) => {
    const balance = a.openingObligation.minorUnits - b.openingObligation.minorUnits;
    const apr = b.aprThousandths - a.aprThousandths;
    return (strategy === 'snowball' ? balance || apr : apr || balance) || (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0);
  });
}
export type AccountPeriod = Readonly<{ accountId: AccountId; openingObligation: Money; interestAccrued: Money; minimumPaid: Money; extraPaid: Money; totalPaid: Money; closingObligation: Money }>;
export type PayoffPeriod = Readonly<{ period: number; paymentDate: DateOnly; accounts: readonly AccountPeriod[]; totalInterest: Money; totalMinimumPaid: Money; totalExtraPaid: Money; totalPaid: Money; unusedBudget: Money; closingObligation: Money }>;
export type AccountSummary = Readonly<{ accountId: AccountId; inclusion: PayoffAccountInput['inclusion']; balance: Money; openingObligation: Money; remainingObligation: Money; payoffMonth: number | null; payoffDate: DateOnly | null }>;
type Common = Readonly<{ monthlyCommitment: Money; accounts: readonly AccountSummary[]; schedule: readonly PayoffPeriod[] }>;
export type PayoffResult =
  | Readonly<{ status: 'invalidInput' | 'insufficientData'; reason: string }>
  | (Common & Readonly<{ status: 'paidOff'; monthsToPayoff: number; payoffDate: DateOnly | null; totalInterest: Money; totalPayments: Money; unusedBudget: Money }>)
  | (Common & Readonly<{ status: 'paymentShortfall'; period: number; paymentDate: DateOnly; requiredMinimums: Money; availableCommitment: Money; shortfallAmount: Money; accountRequirements: readonly { accountId: AccountId; requiredMinimum: Money }[]; partialInterest: Money; partialPayments: Money }>)
  | (Common & Readonly<{ status: 'notAmortizingUnderAssumptions'; period: number; remainingDebt: Money; partialInterest: Money; partialPayments: Money }>)
  | (Common & Readonly<{ status: 'horizonReached'; periodsSimulated: number; remainingDebt: Money; partialInterest: Money; partialPayments: Money }>);

/** A bounded forecast under constant monthly terms; no historical payments are inferred. */
export function calculatePayoff(input: PayoffInput): PayoffResult {
  try {
    if (!input || typeof input !== 'object') throw new TypeError('Input is required');
    getCurrency(input.currency);
    const money = (n: number) => makeMoney(input.currency, n);
    const validateMoney = (value: Money, name: string, nonnegative = false) => {
      if (!value || typeof value !== 'object') throw new TypeError(`${name} must be money`);
      makeMoney(value.currency, value.minorUnits);
      if (value.currency !== input.currency) throw new TypeError(`${name} currency mismatch`);
      if (nonnegative && value.minorUnits < 0) throw new RangeError(`${name} must be nonnegative`);
    };
    const sum = (values: readonly number[]) => values.reduce((a, b) => addMoney(money(a), money(b)).minorUnits, 0);
    validateMoney(input.extraMonthlyPayment, 'extraMonthlyPayment', true);
    if (input.fixedMonthlyCommitment !== undefined) validateMoney(input.fixedMonthlyCommitment, 'fixedMonthlyCommitment', true);
    if (input.strategy !== 'snowball' && input.strategy !== 'avalanche') throw new TypeError('Invalid strategy');
    const horizon = input.maxHorizonMonths === undefined ? 600 : input.maxHorizonMonths;
    if (!Number.isSafeInteger(horizon) || horizon <= 0) throw new RangeError('Invalid maxHorizonMonths');
    if (!input.assumptions || typeof input.assumptions.firstPaymentDate !== 'string') throw new TypeError('Invalid assumptions');
    monthlyPaymentDate(input.assumptions.firstPaymentDate, input.assumptions.requestedDay, 0);
    householdDate(new Date('2024-01-01T00:00:00Z'), input.assumptions.householdTimeZone);
    const inventory = input.accounts;
    if (!inventory || typeof inventory !== 'object') throw new TypeError('Invalid account inventory');
    if (inventory.status === 'loading' || inventory.status === 'unavailable') return { status: 'insufficientData', reason: `Account inventory is ${inventory.status}` };
    if (inventory.status !== 'known-empty' && inventory.status !== 'available' && inventory.status !== 'partial' && inventory.status !== 'stale') throw new TypeError('Invalid inventory status');
    if (!inventory.context || !inventory.context.coverage || !['unknown', 'partial', 'complete'].includes(inventory.context.coverage.status)) throw new TypeError('Invalid inventory coverage');
    if (inventory.status === 'known-empty' && inventory.context.coverage.status === 'unknown') return { status: 'insufficientData', reason: 'Empty inventory has unknown coverage' };
    const accounts = inventory.status === 'known-empty' ? [] : inventory.data;
    if (!Array.isArray(accounts)) throw new TypeError('Invalid account list');
    const ids = new Set<string>();
    for (const account of accounts) {
      if (!account || typeof account.accountId !== 'string' || !account.accountId) throw new TypeError('Invalid accountId');
      if (ids.has(account.accountId)) throw new TypeError(`Duplicate accountId: ${account.accountId}`);
      ids.add(account.accountId);
      if (!['accelerated', 'minimum-only', 'excluded'].includes(account.inclusion)) throw new TypeError(`Invalid inclusion: ${account.accountId}`);
      validateMoney(account.balance, `${account.accountId} balance`);
      if (account.scheduledMinimum != null) validateMoney(account.scheduledMinimum, `${account.accountId} scheduledMinimum`, true);
      if (account.aprThousandths != null && (!Number.isInteger(account.aprThousandths) || account.aprThousandths < 0 || account.aprThousandths > 100000)) throw new RangeError(`Invalid APR: ${account.accountId}`);
    }
    const missing = accounts.filter(a => a.inclusion !== 'excluded' && a.balance.minorUnits > 0 && (a.aprThousandths == null || a.scheduledMinimum == null));
    if (missing.length) return { status: 'insufficientData', reason: `Missing APR or scheduled minimum: ${missing.map(a => a.accountId).join(', ')}` };
    const states = accounts.map(a => ({ account: a, opening: a.inclusion === 'excluded' ? 0 : Math.max(a.balance.minorUnits, 0), remaining: a.inclusion === 'excluded' ? 0 : Math.max(a.balance.minorUnits, 0), payoffMonth: null as number | null, payoffDate: null as DateOnly | null }));
    const initial = sum(states.map(s => s.remaining));
    const minimums = sum(states.filter(s => s.remaining > 0).map(s => s.account.scheduledMinimum!.minorUnits));
    const commitment = input.fixedMonthlyCommitment?.minorUnits ?? sum([minimums, input.extraMonthlyPayment.minorUnits]);
    const monthlyCommitment = money(commitment), schedule: PayoffPeriod[] = [];
    const summaries = (): AccountSummary[] => states.map(s => ({ accountId: s.account.accountId, inclusion: s.account.inclusion, balance: s.account.balance, openingObligation: money(s.opening), remainingObligation: money(s.remaining), payoffMonth: s.payoffMonth, payoffDate: s.payoffDate }));
    const common = () => ({ monthlyCommitment, accounts: summaries(), schedule: [...schedule] });
    let interestTotal = 0, paymentsTotal = 0;
    if (initial === 0) return { status: 'paidOff', ...common(), monthsToPayoff: 0, payoffDate: null, totalInterest: money(0), totalPayments: money(0), unusedBudget: money(input.extraMonthlyPayment.minorUnits) };
    for (let period = 1; period <= horizon; period++) {
      const paymentDate = monthlyPaymentDate(input.assumptions.firstPaymentDate, input.assumptions.requestedDay, period - 1);
      const rows = states.map(s => {
        const opening = s.remaining;
        const interest = opening ? multiplyMoneyRatio(money(opening), BigInt(s.account.aprThousandths!), BigInt(1200000)).minorUnits : 0;
        const post = sum([opening, interest]);
        const minimum = opening ? Math.min(post, s.account.scheduledMinimum!.minorUnits) : 0;
        return { s, opening, interest, post, minimum, extra: 0 };
      });
      const openingTotal = sum(rows.map(r => r.opening)), required = sum(rows.map(r => r.minimum));
      if (required > commitment) return { status: 'paymentShortfall', ...common(), period, paymentDate, requiredMinimums: money(required), availableCommitment: monthlyCommitment, shortfallAmount: money(required - commitment), accountRequirements: rows.filter(r => r.opening > 0).map(r => ({ accountId: r.s.account.accountId, requiredMinimum: money(r.minimum) })), partialInterest: money(interestTotal), partialPayments: money(paymentsTotal) };
      let budget = commitment - required;
      const ranked = rankAcceleratedAccounts(rows.filter(r => r.s.account.inclusion === 'accelerated' && r.post > r.minimum).map(r => ({ ...r, accountId: r.s.account.accountId, openingObligation: money(r.opening), aprThousandths: r.s.account.aprThousandths! })), input.strategy);
      for (const r of ranked) { const extra = Math.min(r.post - r.minimum, budget); rows.find(row => row.s === r.s)!.extra = extra; budget -= extra; }
      const accountRows = rows.map(r => {
        r.s.remaining = r.post - r.minimum - r.extra;
        if (r.opening > 0 && r.s.remaining === 0) { r.s.payoffMonth = period; r.s.payoffDate = paymentDate; }
        return { accountId: r.s.account.accountId, openingObligation: money(r.opening), interestAccrued: money(r.interest), minimumPaid: money(r.minimum), extraPaid: money(r.extra), totalPaid: money(sum([r.minimum, r.extra])), closingObligation: money(r.s.remaining) };
      });
      const interest = sum(rows.map(r => r.interest)), extra = sum(rows.map(r => r.extra)), paid = sum([required, extra]), remaining = sum(states.map(s => s.remaining));
      interestTotal = sum([interestTotal, interest]); paymentsTotal = sum([paymentsTotal, paid]);
      schedule.push({ period, paymentDate, accounts: accountRows, totalInterest: money(interest), totalMinimumPaid: money(required), totalExtraPaid: money(extra), totalPaid: money(paid), unusedBudget: money(budget), closingObligation: money(remaining) });
      if (remaining === 0) return { status: 'paidOff', ...common(), monthsToPayoff: period, payoffDate: paymentDate, totalInterest: money(interestTotal), totalPayments: money(paymentsTotal), unusedBudget: money(budget) };
      if (remaining >= openingTotal) return { status: 'notAmortizingUnderAssumptions', ...common(), period, remainingDebt: money(remaining), partialInterest: money(interestTotal), partialPayments: money(paymentsTotal) };
      if (period === horizon) return { status: 'horizonReached', ...common(), periodsSimulated: period, remainingDebt: money(remaining), partialInterest: money(interestTotal), partialPayments: money(paymentsTotal) };
    }
    throw new Error('Unreachable projection state');
  } catch (error) { return { status: 'invalidInput', reason: error instanceof Error ? error.message : 'Invalid input' }; }
}
