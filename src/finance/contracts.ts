import type { DateOnly } from './calendar';
import type { Money } from './money';

export type HouseholdId = string;
export type AccountId = string;
export type Source = Readonly<{ id: string; kind: string }>;
/** Unknown coverage is distinct from a source claiming complete or partial coverage. */
export type Coverage =
  | Readonly<{ status: 'unknown' }>
  | Readonly<{ status: 'complete' | 'partial'; description: string }>;
export type DataContext = Readonly<{
  householdId: HouseholdId;
  source: Source;
  asOf: DateOnly | null;
  coverage: Coverage;
}>;
/** An empty result is an explicit state, never inferred from failed or incomplete loading. */
export type Availability<T> =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'unavailable'; reason: string }>
  | Readonly<{ status: 'known-empty'; context: DataContext }>
  | Readonly<{ status: 'available'; data: T; context: DataContext }>
  | Readonly<{ status: 'partial'; data: T; context: DataContext }>
  | Readonly<{ status: 'stale'; data: T; context: DataContext }>;
/** Positive is owed; negative is a credit. These meanings are not interchangeable. */
export type BalanceObservation = Readonly<{
  accountId: AccountId;
  context: DataContext;
  asOf: DateOnly;
  amount: Money;
  kind: 'recorded-balance' | 'principal' | 'statement-balance' | 'payoff-quote';
}>;
/** First payment is supplied explicitly; no default calculation date is selected here. */
export type ProjectionAssumptions = Readonly<{
  firstPaymentDate: DateOnly;
  requestedDay: number;
  householdTimeZone: string;
}>;
export type RecordedData<T> = Readonly<{ kind: 'recorded'; value: T; context: DataContext }>;
export type ProjectionInput<T> = Readonly<{ kind: 'projection'; assumptions: ProjectionAssumptions; value: T }>;
