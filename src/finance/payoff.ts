// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { makeMoney, addMoney, multiplyMoneyRatio, type Money } from './money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { monthlyPaymentDate, householdDate, parseDateOnly, type DateOnly } from './calendar.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import type { AccountId, Availability, ProjectionAssumptions } from './contracts.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { getCurrency } from './currencies.ts';

export type PayoffStrategy = 'snowball' | 'avalanche' | 'custom';
export type PayoffAccountInput = Readonly<{ accountId: AccountId; inclusion: 'accelerated' | 'minimum-only' | 'excluded'; balance: Money; aprThousandths: number | null; scheduledMinimum: Money | null; promo?: Readonly<{ promoAprThousandths: number; promoEndDate: DateOnly; postPromoAprThousandths: number }> }>;
export type PayoffInput = Readonly<{ accounts: Availability<readonly PayoffAccountInput[]>; assumptions: ProjectionAssumptions; strategy: PayoffStrategy; customOrderIds?: readonly string[]; currency: string; extraMonthlyPayment: Money; extraFirstMonthPayment?: Money; extraOneTimePayment?: Money; extraOneTimePeriod?: number; fixedMonthlyCommitment?: Money; maxHorizonMonths?: number }>;
export type RankableAccount = Readonly<{ accountId: AccountId; openingObligation: Money; aprThousandths: number }>;
export function rankAcceleratedAccounts<T extends RankableAccount>(accounts: readonly T[], strategy: PayoffStrategy, customOrderIds: readonly string[] = []): T[] {
  return [...accounts].sort((a, b) => {
    const balance = a.openingObligation.minorUnits - b.openingObligation.minorUnits;
    const apr = b.aprThousandths - a.aprThousandths;
    const ai = customOrderIds.indexOf(a.accountId), bi = customOrderIds.indexOf(b.accountId);
    const custom = strategy === 'custom' ? (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) : 0;
    return custom || (strategy === 'snowball' ? balance || apr : apr || balance) || (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0);
  });
}
export type AccountPeriod = Readonly<{ accountId: AccountId; openingObligation: Money; interestAccrued: Money; minimumPaid: Money; extraPaid: Money; totalPaid: Money; closingObligation: Money }>;
export type PayoffPeriod = Readonly<{ period: number; paymentDate: DateOnly; accounts: readonly AccountPeriod[]; totalInterest: Money; totalMinimumPaid: Money; totalExtraPaid: Money; totalPaid: Money; unusedBudget: Money; closingObligation: Money }>;
export type AccountSummary = Readonly<{ accountId: AccountId; inclusion: PayoffAccountInput['inclusion']; balance: Money; openingObligation: Money; remainingObligation: Money; payoffMonth: number | null; payoffDate: DateOnly | null }>;
type Common = Readonly<{ monthlyCommitment: Money; accounts: readonly AccountSummary[]; schedule: readonly PayoffPeriod[]; inventoryStatus: 'known-empty' | 'available' | 'partial' | 'stale'; coverageStatus: 'unknown' | 'partial' | 'complete'; coverageScope: 'verified-household' | 'entered-accounts-only' }>;
export type PayoffResult =
  | Readonly<{ status: 'invalidInput' | 'insufficientData'; reason: string }>
  | (Common & Readonly<{ status: 'paidOff'; monthsToPayoff: number; payoffDate: DateOnly | null; totalInterest: Money; totalPayments: Money; unusedBudget: Money }>)
  | (Common & Readonly<{ status: 'paymentShortfall'; period: number; paymentDate: DateOnly; requiredMinimums: Money; availableCommitment: Money; shortfallAmount: Money; accountRequirements: readonly { accountId: AccountId; requiredMinimum: Money }[]; partialInterest: Money; partialPayments: Money }>)
  | (Common & Readonly<{ status: 'notAmortizingUnderAssumptions'; period: number; remainingDebt: Money; partialInterest: Money; partialPayments: Money; nonAmortizingAccountIds?: readonly AccountId[] }>)
  | (Common & Readonly<{ status: 'horizonReached'; periodsSimulated: number; remainingDebt: Money; partialInterest: Money; partialPayments: Money }>);

export function calculateSnowflakeImpact(input: PayoffInput, boostAmount: Money, mode: 'oneTime' | 'monthly'): { monthsSaved: number; interestSaved: Money } | null {
  try {
    if (boostAmount.currency !== input.currency || boostAmount.minorUnits < 0 || (mode !== 'oneTime' && mode !== 'monthly')) return null;
    const baseline = calculatePayoff(input);
    const boosted = calculatePayoff(mode === 'monthly'
      ? { ...input, extraMonthlyPayment: addMoney(input.extraMonthlyPayment, boostAmount), ...(input.fixedMonthlyCommitment ? { fixedMonthlyCommitment: addMoney(input.fixedMonthlyCommitment, boostAmount) } : {}) }
      : { ...input, extraFirstMonthPayment: addMoney(input.extraFirstMonthPayment ?? makeMoney(input.currency, 0), boostAmount) });
    if (baseline.status !== 'paidOff' || boosted.status !== 'paidOff') return null;
    return { monthsSaved: baseline.monthsToPayoff - boosted.monthsToPayoff, interestSaved: makeMoney(input.currency, baseline.totalInterest.minorUnits - boosted.totalInterest.minorUnits) };
  } catch { return null; }
}

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
    if (input.extraFirstMonthPayment !== undefined) validateMoney(input.extraFirstMonthPayment, 'extraFirstMonthPayment', true);
    if (input.extraOneTimePayment !== undefined) validateMoney(input.extraOneTimePayment, 'extraOneTimePayment', true);
    if (input.extraOneTimePeriod !== undefined && (!Number.isSafeInteger(input.extraOneTimePeriod) || input.extraOneTimePeriod < 1)) throw new RangeError('Invalid extraOneTimePeriod');
    if (input.fixedMonthlyCommitment !== undefined) validateMoney(input.fixedMonthlyCommitment, 'fixedMonthlyCommitment', true);
    const firstMonthExtra = input.extraFirstMonthPayment?.minorUnits ?? 0;
    const oneTimeExtra = input.extraOneTimePayment?.minorUnits ?? 0;
    const oneTimePeriod = input.extraOneTimePeriod ?? 1;
    if (input.strategy !== 'snowball' && input.strategy !== 'avalanche' && input.strategy !== 'custom') throw new TypeError('Invalid strategy');
    if (input.customOrderIds !== undefined && (!Array.isArray(input.customOrderIds) || input.customOrderIds.some(id => typeof id !== 'string'))) throw new TypeError('Invalid custom order');
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
    if (inventory.status === 'known-empty' && inventory.context.coverage.status !== 'complete') return { status: 'insufficientData', reason: 'Empty inventory has unverified household coverage' };
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
      if (account.promo) {
        for (const rate of [account.promo.promoAprThousandths, account.promo.postPromoAprThousandths]) if (!Number.isInteger(rate) || rate < 0 || rate > 100000) throw new RangeError(`Invalid promo APR: ${account.accountId}`);
        parseDateOnly(account.promo.promoEndDate);
      }
    }
    const missing = accounts.filter(a => a.inclusion !== 'excluded' && a.balance.minorUnits > 0 && (a.aprThousandths == null || a.scheduledMinimum == null));
    if (missing.length) return { status: 'insufficientData', reason: `Missing APR or scheduled minimum: ${missing.map(a => a.accountId).join(', ')}` };
    const states = accounts.map(a => ({ account: a, opening: a.inclusion === 'excluded' ? 0 : Math.max(a.balance.minorUnits, 0), remaining: a.inclusion === 'excluded' ? 0 : Math.max(a.balance.minorUnits, 0), payoffMonth: null as number | null, payoffDate: null as DateOnly | null }));
    const initial = sum(states.map(s => s.remaining));
    const minimums = sum(states.filter(s => s.remaining > 0).map(s => s.account.scheduledMinimum!.minorUnits));
    const commitment = input.fixedMonthlyCommitment?.minorUnits ?? sum([minimums, input.extraMonthlyPayment.minorUnits]);
    const monthlyCommitment = money(commitment), schedule: PayoffPeriod[] = [];
    const summaries = (): AccountSummary[] => states.map(s => ({ accountId: s.account.accountId, inclusion: s.account.inclusion, balance: s.account.balance, openingObligation: money(s.opening), remainingObligation: money(s.remaining), payoffMonth: s.payoffMonth, payoffDate: s.payoffDate }));
    // A partial, unknown or stale account set can only support an entered-account projection.
    // A complete snapshot may support household-level coverage but still is a forecast, not
    // proof that a future payoff has actually occurred.
    const coverageScope = inventory.context.coverage.status === 'complete' &&
      !accounts.some(a => a.inclusion === 'excluded' && a.balance.minorUnits > 0) &&
      (inventory.status === 'available' || inventory.status === 'known-empty')
      ? 'verified-household' as const : 'entered-accounts-only' as const;
    const common = () => ({ monthlyCommitment, accounts: summaries(), schedule: [...schedule], inventoryStatus: inventory.status, coverageStatus: inventory.context.coverage.status, coverageScope });
    let interestTotal = 0, paymentsTotal = 0;
    if (initial === 0 && coverageScope !== 'verified-household') return { status: 'insufficientData', reason: `No tracked obligation; ${inventory.status} inventory with ${inventory.context.coverage.status} household coverage cannot verify debt freedom` };
    if (initial === 0) return { status: 'paidOff', ...common(), monthsToPayoff: 0, payoffDate: null, totalInterest: money(0), totalPayments: money(0), unusedBudget: money(sum([input.extraMonthlyPayment.minorUnits, firstMonthExtra, oneTimePeriod === 1 ? oneTimeExtra : 0])) };
    for (let period = 1; period <= horizon; period++) {
      const paymentDate = monthlyPaymentDate(input.assumptions.firstPaymentDate, input.assumptions.requestedDay, period - 1);
      const rows = states.map(s => {
        const opening = s.remaining;
        const promo = s.account.promo;
        const rate = promo ? (paymentDate <= promo.promoEndDate ? promo.promoAprThousandths : promo.postPromoAprThousandths) : s.account.aprThousandths!;
        const interest = opening ? multiplyMoneyRatio(money(opening), BigInt(rate), BigInt(1200000)).minorUnits : 0;
        const post = sum([opening, interest]);
        const minimum = opening ? Math.min(post, s.account.scheduledMinimum!.minorUnits) : 0;
        return { s, opening, interest, post, minimum, rate, extra: 0 };
      });
      const required = sum(rows.map(r => r.minimum));
      const periodCommitment = sum([commitment, period === 1 ? firstMonthExtra : 0, period === oneTimePeriod ? oneTimeExtra : 0]);
      if (required > periodCommitment) return { status: 'paymentShortfall', ...common(), period, paymentDate, requiredMinimums: money(required), availableCommitment: money(periodCommitment), shortfallAmount: money(required - periodCommitment), accountRequirements: rows.filter(r => r.opening > 0).map(r => ({ accountId: r.s.account.accountId, requiredMinimum: money(r.minimum) })), partialInterest: money(interestTotal), partialPayments: money(paymentsTotal) };
      let budget = periodCommitment - required;
      const ranked = rankAcceleratedAccounts(rows.filter(r => r.s.account.inclusion === 'accelerated' && r.post > r.minimum).map(r => ({ ...r, accountId: r.s.account.accountId, openingObligation: money(r.opening), aprThousandths: r.rate })), input.strategy, input.customOrderIds);
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
      // If NO active debt shrinks this period (every active debt closes >= opening),
      // no debt can ever pay off to free commitment for others under fixed terms.
      // When a one-time payment is scheduled later within the horizon, wait until it applies.
      const pendingOneTimeInHorizon = oneTimeExtra > 0 && oneTimePeriod <= horizon && period < oneTimePeriod;
      const activeRows = rows.filter(r => r.opening > 0);
      const fixedPoint = rows.every(r => r.s.remaining === r.opening);
      const noDebtShrinking = activeRows.length > 0 && activeRows.every(r => r.s.remaining >= r.opening);
      const pendingPromoChange = activeRows.some(r => r.s.account.promo && paymentDate <= r.s.account.promo.promoEndDate);
      if (!pendingOneTimeInHorizon && !pendingPromoChange && (fixedPoint || noDebtShrinking)) {
        return {
          status: 'notAmortizingUnderAssumptions',
          ...common(),
          period,
          remainingDebt: money(remaining),
          partialInterest: money(interestTotal),
          partialPayments: money(paymentsTotal),
          nonAmortizingAccountIds: activeRows.filter(r => r.s.remaining >= r.opening).map(r => r.s.account.accountId),
        };
      }
      if (period === horizon) return { status: 'horizonReached', ...common(), periodsSimulated: period, remainingDebt: money(remaining), partialInterest: money(interestTotal), partialPayments: money(paymentsTotal) };
    }
    throw new Error('Unreachable projection state');
  } catch (error) { return { status: 'invalidInput', reason: error instanceof Error ? error.message : 'Invalid input' }; }
}

/** Compare equal monthly commitments under the payoff engine's assumptions. */
export function calculateConsolidationComparison(params: { accounts: readonly { balance: Money; aprThousandths: number; scheduledMinimum: Money }[]; offerAprThousandths: number; transferFeeBps: number; monthlyPayment: Money; currency: string; assumptions: ProjectionAssumptions }): { worthIt: boolean; netSavings: Money; feeAmount: Money; breakEvenMonths: number | null; oldTotalInterest: Money; newTotalInterest: Money } | null {
  try {
    if (!Number.isSafeInteger(params.transferFeeBps) || params.transferFeeBps < 0 || !params.accounts.length) return null;
    const principal = params.accounts.reduce((sum, account) => addMoney(sum, account.balance), makeMoney(params.currency, 0));
    if (principal.minorUnits <= 0 || params.accounts.some(a => a.balance.minorUnits < 0)) return null;
    const fee = multiplyMoneyRatio(principal, BigInt(params.transferFeeBps), 10000n);
    const context = { householdId: 'comparison', source: { id: 'comparison', kind: 'projection' }, asOf: null, coverage: { status: 'complete' as const, description: 'Comparison inputs' } };
    const simulate = (accounts: readonly PayoffAccountInput[]) => calculatePayoff({ accounts: { status: 'available', data: accounts, context }, assumptions: params.assumptions, strategy: 'avalanche', currency: params.currency, extraMonthlyPayment: makeMoney(params.currency, 0), fixedMonthlyCommitment: params.monthlyPayment });
    const old = simulate(params.accounts.map((a, i) => ({ ...a, accountId: String(i), inclusion: 'accelerated' })));
    const loan = simulate([{ accountId: 'loan', inclusion: 'accelerated', balance: addMoney(principal, fee), aprThousandths: params.offerAprThousandths, scheduledMinimum: params.monthlyPayment }]);
    if (old.status !== 'paidOff' || loan.status !== 'paidOff') return null;
    const savings = old.totalInterest.minorUnits - loan.totalInterest.minorUnits - fee.minorUnits;
    let oldInterest = 0, newInterest = 0, breakEvenMonths: number | null = null;
    for (let i = 0; i < Math.max(old.schedule.length, loan.schedule.length); i++) {
      oldInterest += old.schedule[i]?.totalInterest.minorUnits ?? 0;
      newInterest += loan.schedule[i]?.totalInterest.minorUnits ?? 0;
      if (breakEvenMonths === null && oldInterest - newInterest >= fee.minorUnits) breakEvenMonths = i + 1;
    }
    return { worthIt: savings > 0, netSavings: makeMoney(params.currency, savings), feeAmount: fee, breakEvenMonths, oldTotalInterest: old.totalInterest, newTotalInterest: loan.totalInterest };
  } catch { return null; }
}
