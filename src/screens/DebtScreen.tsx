import { transactionHasBillId } from '../finance/bill-identity';
import { memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import * as Crypto from 'expo-crypto';
import { Alert, Keyboard, Platform, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, ScrollView, Text, TextInput, View, appearanceColor, useNativeAppearance } from '../components/NativeAppearance';
import type { AppearancePalette } from '../components/appearance-theme';
import Svg, { Defs, LinearGradient, Path, Rect, Stop, Circle } from 'react-native-svg';
import { Card, FinancialScreen, FloatingAddButton, Segments, SwipeProtectedHorizontalArea, snapshot, ui, useScrollFadeOpacity } from '../components/FinancialScreen';
import { HeroGradient } from '../components/HeroGradient';
import { InspireCornerArt, InspireQuote, type InspireArtKind } from '../components/InspireArt';
import { AppIcon, type AppIconName } from '../components/AppIcon';
import { acceptAprEdit, calculateIndependentMortgageProjections, calculateStrategyScenario, canSuggestLoanPaymentSplit, comparePayoffStrategies, estimateMinimumPayment, findPreviousLoanPaymentDate, formatCurrency, homeDebtFreeEstimateDate, isActiveDebtItem, acceptMoneyEdit, projectedLoanBalanceAfterPrincipal, resolveAutoLoanSplitSuggestion, resolveNextAutoDueDate, resolveOneTimePaymentPeriod, suggestLoanPaymentSplit, validateExtraPaymentInput, formatEditableMoney, parseMoneyInput, parsePercentInput, type DebtCategory, type DebtItem, type LoanBillPairing, type PayoffPlanResult, type PayoffStrategy } from '../onboarding-domain';
import { currentHouseholdDate, currentHouseholdMonth, getNextMonthString, getPreviousMonthString, parseDateOnly, type DateOnly } from '../finance/calendar';
import { getObligationCycle, type ObligationSchedules } from '../finance/obligation-schedule';
import { addMoney, moneyFromMajor, moneyToMajor, parseMoney, type Money } from '../finance/money';
import { getCurrency } from '../finance/currencies';
import { calculateTransactionBalanceDelta, classifyCategoryDirection, isPaidOffAccountArchived, type LedgerTransaction, type ReconciliationAnchor, type TransactionCategory } from '../finance/ledger';
import { SelectDropdown, type DropdownOption } from '../components/SelectDropdown';
import { CalendarDatePickerModal, DueDayPickerModal, formatShortDate } from '../components/DatePickerModal';
import { historicalBillIdsByDebtId, uniqueHistoricalBillIdByDebtId } from '../finance/loan-bill-pairing';
import { resolveRecurringBillDate, type RecurringBill } from '../finance/recurring-bills';
import { resolveEffectiveDebtSchedule } from '../finance/payment-matching';
import type { DebtDetailsDraft } from './HomeScreen';
import { AmountText } from '../components/AmountText';
import { AccountMark } from '../components/AccountMark';
import { InformationButton as InfoButton, useInformationSheet } from '../components/InformationSheet';
import { AdaptiveModal } from '../components/ModalOverlay';
import { SheetFormHeader, SheetModal } from '../components/SheetModal';
import { bottomInsetPadding } from '../components/bottom-inset';
import { DEFAULT_TAB_UI_PREFERENCES, useAccountsUiPreferences, useSetTabUiPreferences, type AccountsCategoryFilter, type TabUiPreferences } from '../components/TabShellContext';

function roundToCurrencyScale(amount: number, currencyCode: string): number {
  const factor = 10 ** getCurrency(currencyCode).scale;
  return Math.round((amount + Number.EPSILON) * factor) / factor;
}

function formatOrdinal(n: number): string {
  const absolute = Math.abs(Math.trunc(n));
  const lastTwo = absolute % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[absolute % 10] ?? 'th';
  return `${n}${suffix}`;
}

function parseMoneyDraft(raw: string, currencyCode: string): { valid: true; amount: number } | { valid: false; amount: number } {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '.') return { valid: true, amount: 0 };
  const normalized = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  const parsed = parseMoneyInput(normalized, currencyCode);
  if (parsed === null || parsed < 0) return { valid: false, amount: 0 };
  return { valid: true, amount: parsed };
}

function getAccountReductionDisplay(
  item: DebtItem,
  archived: boolean,
  palette: AppearancePalette,
): { trackPercent: number; color: string; label: string; badgeText: string | null } {
  if (archived) {
    return {
      trackPercent: 100,
      color: palette.posInk,
      label: item.originalBalance === 0 ? '100% paid off' : '\u2193 100% paid off',
      badgeText: item.originalBalance === 0 ? '100%' : '\u2193 100%',
    };
  }
  if (item.originalBalance == null) {
    return {
      trackPercent: 0,
      color: palette.muted,
      label: 'Original balance not set',
      badgeText: null,
    };
  }
  const orig = item.originalBalance;
  const bal = Math.max(0, item.balance);
  if (bal < orig) {
    const pct = orig > 0 ? Math.min(100, Math.max(0, ((orig - bal) / orig) * 100)) : 0;
    return {
      trackPercent: pct,
      color: palette.posInk,
      label: `\u2193 ${pct.toFixed(1)}% reduced`,
      badgeText: `\u2193 ${Math.round(pct)}%`,
    };
  }
  if (bal > orig) {
    const incPct = orig > 0 ? ((bal - orig) / orig) * 100 : null;
    return {
      trackPercent: 0,
      color: palette.neg,
      label: incPct !== null ? `\u2191 ${incPct.toFixed(1)}% increase` : '\u2191 Balance increased',
      badgeText: incPct !== null ? `\u2191 ${Math.round(incPct)}%` : '\u2191 Higher',
    };
  }
  return {
    trackPercent: 0,
    color: palette.muted,
    label: '0.0% change',
    badgeText: '0%',
  };
}

type AccountFilter = AccountsCategoryFilter;
const accountFilterOrder: AccountFilter[] = ['All', 'Credit Cards', 'Personal Loans', 'Auto', 'Home', 'Paid Off'];
const EMPTY_ARCHIVED_DEBT_IDS: readonly string[] = [];
function AccountBalanceTrack({ percent }: { percent: number }) {
  const { isInspire, palette } = useNativeAppearance();
  const trackGradId = `acctTrack_${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View
      style={{
        height: 8.5,
        borderRadius: 999,
        backgroundColor: palette.raised,
        borderWidth: isInspire ? 1.3 : 0,
        borderColor: palette.graphOutline,
        overflow: 'hidden',
      }}
    >
      {clamped > 0 ? (
        <View
          style={{
            width: `${clamped}%`,
            height: '100%',
            borderRadius: 999,
            overflow: 'hidden',
            borderRightWidth: isInspire && clamped < 100 ? 1 : 0,
            borderRightColor: palette.graphOutline,
          }}
        >
          {isInspire ? (
            <Svg width="100%" height="100%" preserveAspectRatio="none">
              <Defs>
                <LinearGradient id={trackGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <Stop offset="0%" stopColor={palette.pos} />
                  <Stop offset="100%" stopColor={palette.posInk} />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill={`url(#${trackGradId})`} />
            </Svg>
          ) : (
            <View style={{ flex: 1, backgroundColor: palette.pos }} />
          )}
        </View>
      ) : null}
    </View>
  );
}

const isPersonalLoan = (item: DebtItem) => item.category === 'Personal loan' || item.category === 'Student loan' || item.category === 'Medical debt' || item.category === 'Other loan';
function HeroOrbit() {
  return <View pointerEvents="none" accessible={false} style={{ position: 'absolute', right: -60, top: -50, width: 210, height: 210 }}>{[0, 18, 36].map(inset => <View key={inset} style={{ position: 'absolute', inset, borderRadius: 110, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }} />)}</View>;
}
const sortOptions: readonly DropdownOption<number>[] = [
  { value: 0, label: 'Name', icon: 'sort' }, { value: 1, label: 'Balance', icon: 'sort' },
  { value: 2, label: 'APR', icon: 'sort' }, { value: 3, label: 'Payoff', icon: 'calendar' },
];
const detailSections = ['Overview', 'Transactions', 'Detail'] as const;
const txPeriods = ['Current month', 'Previous month', 'Lifetime'] as const;
const txPeriodOptions: readonly DropdownOption<string>[] = txPeriods.map(value => ({ value, label: value, icon: 'calendar' }));
const detailCategoryOptions: readonly DropdownOption<DebtCategory>[] = [
  { value: 'Mortgage', label: 'Mortgage', subtitle: 'Home loan with separate escrow tracking', icon: 'homeLoan' },
  { value: 'Credit card', label: 'Credit card', subtitle: 'Revolving line of credit', icon: 'creditCard' },
  { value: 'Auto loan', label: 'Auto loan', subtitle: 'Vehicle financing', icon: 'auto' },
  { value: 'Student loan', label: 'Student loan', subtitle: 'Higher education loan', icon: 'debt' },
  { value: 'Personal loan', label: 'Personal loan', subtitle: 'Unsecured installment loan', icon: 'debt' },
  { value: 'Medical debt', label: 'Medical debt', subtitle: 'Healthcare balance', icon: 'debt' },
  { value: 'Other loan', label: 'Other loan', subtitle: 'General debt obligation', icon: 'debt' },
];
const ACCOUNT_TX_CATEGORY_CHOICES: readonly {
  label: string;
  subtitle: string;
  category: TransactionCategory;
  icon: AppIconName;
}[] = [
  { label: 'Payment', subtitle: 'Reduces this account balance', category: 'payment', icon: 'check' },
  { label: 'Purchase', subtitle: 'Adds a charge to this account', category: 'purchase', icon: 'creditCard' },
  { label: 'Subscription', subtitle: 'Recurring charge on this account', category: 'subscription', icon: 'creditCard' },
  { label: 'Utilities', subtitle: 'Utility charge on this account', category: 'utilities', icon: 'creditCard' },
  { label: 'Interest', subtitle: 'Interest charge accrued', category: 'interest', icon: 'creditCard' },
  { label: 'Fee', subtitle: 'Account fee or annual fee', category: 'fee', icon: 'creditCard' },
  { label: 'Refund', subtitle: 'Credit or refund reducing balance', category: 'refund', icon: 'check' },
];

const DETAIL_MONEY_FORMATTERS = new Map<number, Intl.NumberFormat>();
function getDetailMoneyFormatter(scale: number): Intl.NumberFormat {
  let formatter = DETAIL_MONEY_FORMATTERS.get(scale);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: scale, maximumFractionDigits: scale });
    DETAIL_MONEY_FORMATTERS.set(scale, formatter);
  }
  return formatter;
}

function formatDetailMoneyDisplay(raw: string, currencyCode: string, focused: boolean): string {
  if (focused || !raw.trim()) return raw;
  const amount = parseMoneyInput(raw, currencyCode, true);
  if (amount === null) return raw;
  const scale = getCurrency(currencyCode).scale;
  return getDetailMoneyFormatter(scale).format(amount);
}

function BalanceSparkline({
  selected,
  anchors,
  currencySymbol,
}: {
  selected: DebtItem;
  anchors: ReconciliationAnchor[];
  currencySymbol: string;
}) {
  const { palette } = useNativeAppearance();
  const sparkColor = palette.posInk;
  const lossColor = palette.neg;
  const startBalance = selected.originalBalance != null && selected.originalBalance > 0
    ? selected.originalBalance
    : selected.balance;
  const currentBalance = selected.balance;

  const accountAnchors = anchors
    .filter(a => a.accountId === selected.id)
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));

  const points: { label: string; value: number }[] = [
    { label: 'Start', value: startBalance },
    ...accountAnchors.map(a => ({
      label: a.asOfDate.slice(5),
      value: moneyToMajor(a.verifiedBalance),
    })),
    { label: 'Now', value: currentBalance },
  ];

  const width = 300;
  const height = 90;
  const padX = 16;
  const padY = 16;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const values = points.map(p => p.value);
  const minVal = Math.min(...values) * 0.95;
  const maxVal = Math.max(...values, 1) * 1.05;
  const valRange = maxVal - minVal || 1;

  const coords = points.map((p, idx) => {
    const x = padX + (idx / Math.max(1, points.length - 1)) * plotW;
    const y = padY + plotH - ((p.value - minVal) / valRange) * plotH;
    return { x, y, ...p };
  });

  const linePath = coords.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`, '');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(padY + plotH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padY + plotH).toFixed(1)} Z`;

  return (
    <Card>
      <View style={[ui.row, { justifyContent: 'space-between', marginBottom: 8 }]}>
        <View>
          <Text style={ui.heading}>Statement records</Text>
          <Text style={ui.small}>
            {accountAnchors.length} statement {accountAnchors.length === 1 ? 'record' : 'records'} logged
          </Text>
        </View>
        <View style={ui.badge}>
          <Text style={ui.badgeText}>SPARKLINE</Text>
        </View>
      </View>

      <View style={{ alignItems: 'center', marginVertical: 6 }}>
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <Defs>
            <LinearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={sparkColor} stopOpacity="0.35" />
              <Stop offset="100%" stopColor={sparkColor} stopOpacity="0.0" />
            </LinearGradient>
          </Defs>
          <Path d={areaPath} fill="url(#sparklineGrad)" />
          <Path d={linePath} fill="none" stroke={sparkColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {coords.map((c, i) => {
            const isLast = i === coords.length - 1;
            return isLast ? (
              <Circle key={i} cx={c.x} cy={c.y} r={4.5} fill={sparkColor} stroke={palette.surface} strokeWidth={2} />
            ) : (
              <Circle key={i} cx={c.x} cy={c.y} r={3} fill={palette.surface} stroke={sparkColor} strokeWidth={1.5} />
            );
          })}
        </Svg>
      </View>

      <View style={[ui.row, { justifyContent: 'space-between', marginTop: 4 }]}>
        <View>
          <Text style={ui.small}>Starting balance</Text>
          <Text style={[ui.value, { fontSize: 13 }]}>{formatCurrency(startBalance, currencySymbol)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={ui.small}>Current balance</Text>
          <Text style={[ui.value, { fontSize: 13, color: currentBalance < startBalance ? sparkColor : currentBalance > startBalance ? lossColor : palette.text }]}>
            {formatCurrency(currentBalance, currencySymbol)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

export const DebtScreen = memo(function DebtScreen({
  debts, plan, currencySymbol, editor, editorOpen = false, error, transactions, reconciliationAnchors = [],
  currencyCode = 'USD',
  archivedPaidOffDebtIds = EMPTY_ARCHIVED_DEBT_IDS,
  onAdd, onEdit: _onEdit, onSaveDebtDetails, onMarkPaid, onRemove, onReconcile, onSettings, initialSelectedId, initialSection, onDismiss,
  strategy = plan.strategy, extraMonthlyPayment = plan.extraMonthlyPayment, onStrategy, onExtra,
  mortgageEscrowByDebtId = {}, mortgageExtraPaymentByDebtId = {}, onMortgageExtra,
  recurringBills = [], loanBillPairings = {}, obligationSchedules,
  householdTimeZone,
  canEdit = true,
  onAddTransaction,
  onSelectTransaction,
}: {
  debts: DebtItem[];
  archivedPaidOffDebtIds?: readonly string[];
  plan: PayoffPlanResult;
  currencySymbol: string;
  editor: ReactNode;
  editorOpen?: boolean;
  error: string;
  transactions: LedgerTransaction[];
  reconciliationAnchors?: ReconciliationAnchor[];
  currencyCode?: string;
  onAdd?: () => void;
  onEdit?: (item: DebtItem) => void;
  onSaveDebtDetails?: (debtId: string, draft: DebtDetailsDraft) => Promise<boolean>;
  onMarkPaid?: (debtId: string) => Promise<void>;
  onRemove?: (item: DebtItem) => void;
  onReconcile?: (item: DebtItem, verifiedBalance: number, reason: 'interest_adjustment' | 'balance_adjustment' | 'credit_adjustment') => unknown;
  onSettings: () => void;
  initialSelectedId?: string | null;
  initialSection?: string;
  strategy?: PayoffStrategy;
  extraMonthlyPayment?: number;
  onStrategy?: (strategy: PayoffStrategy) => Promise<void>;
  onExtra?: (amount: number) => Promise<void>;
  mortgageEscrowByDebtId?: Record<string, number>;
  mortgageExtraPaymentByDebtId?: Record<string, number>;
  onMortgageExtra?: (debtId: string, amount: number) => Promise<void>;
  recurringBills?: RecurringBill[];
  loanBillPairings?: Record<string, LoanBillPairing>;
  onSaveLoanBillPairings?: (pairings: Record<string, LoanBillPairing>) => Promise<void>;
  obligationSchedules?: ObligationSchedules;
  householdTimeZone?: string;
  canEdit?: boolean;
  onAddTransaction?: (tx: LedgerTransaction) => Promise<unknown> | unknown;
  onRecordBillPayment?: (bill: RecurringBill, dueCycle: DateOnly, amount?: Money) => Promise<unknown> | unknown;
  onSelectTransaction?: (tx: LedgerTransaction) => void;
  onDismiss?: () => void;
}) {
  const accountsUi = useAccountsUiPreferences();
  const shellSetUiPreferences = useSetTabUiPreferences();
  const [localUiPreferences, setLocalUiPreferences] = useState<TabUiPreferences>(() => ({
    ...DEFAULT_TAB_UI_PREFERENCES,
    debtSection: initialSection === 'Strategy' ? 'Strategy' : DEFAULT_TAB_UI_PREFERENCES.debtSection,
  }));
  const uiPreferences = accountsUi ?? localUiPreferences;
  const setUiPreferences = shellSetUiPreferences ?? setLocalUiPreferences;
  const updateUiPreferences = useCallback(
    (updates: Partial<TabUiPreferences>) => setUiPreferences(current => ({ ...current, ...updates })),
    [setUiPreferences],
  );
  const filter = uiPreferences.accountsCategory;
  const externalSearchQuery = uiPreferences.accountsSearchQuery;
  const [searchInput, setSearchInput] = useState(externalSearchQuery);
  const [prevExternalSearchQuery, setPrevExternalSearchQuery] = useState(externalSearchQuery);
  const [searchDirty, setSearchDirty] = useState(false);
  if (externalSearchQuery !== prevExternalSearchQuery) {
    setPrevExternalSearchQuery(externalSearchQuery);
    if (!searchDirty && searchInput !== externalSearchQuery) {
      setSearchInput(externalSearchQuery);
    }
  }
  const query = useDeferredValue(searchInput);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushSearch = useCallback((value: string) => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setSearchDirty(false);
    setUiPreferences(current => current.accountsSearchQuery === value ? current : { ...current, accountsSearchQuery: value });
  }, [setUiPreferences]);
  useEffect(() => () => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  }, []);
  const searchOpen = uiPreferences.accountsSearchOpen;
  const sort = uiPreferences.accountsSort;
  const setFilter = (value: AccountFilter) => updateUiPreferences({ accountsCategory: value });
  const setQuery = (value: string) => {
    setSearchInput(value);
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    if (value === '') {
      flushSearch('');
      return;
    }
    setSearchDirty(true);
    searchTimerRef.current = setTimeout(() => flushSearch(value), 180);
  };
  const clearSearch = () => {
    setSearchInput('');
    flushSearch('');
  };
  const setSearchOpen = (value: boolean) => updateUiPreferences({ accountsSearchOpen: value });
  const setSort = (value: number) => updateUiPreferences({ accountsSort: value });
  const [markPaidBusy, setMarkPaidBusy] = useState(false);
  const [markPaidError, setMarkPaidError] = useState('');
  const catFadeIdPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [catScrollMetrics, setCatScrollMetrics] = useState({ offsetX: 0, contentWidth: 0, containerWidth: 0 });
  const canScrollCatLeft = catScrollMetrics.offsetX > 2;
  const canScrollCatRight = catScrollMetrics.contentWidth > catScrollMetrics.containerWidth + 2
    && catScrollMetrics.offsetX < catScrollMetrics.contentWidth - catScrollMetrics.containerWidth - 2;
  const view = uiPreferences.debtSection;
  const setView = (value: 'Accounts' | 'Strategy') => updateUiPreferences({ debtSection: value });
  const [strategyType, setStrategyType] = useState<'Debt strategy' | 'Mortgage strategy'>('Debt strategy');
  const [comparisonExpanded, setComparisonExpanded] = useState(false);
  const [scenarioComparisonExpanded, setScenarioComparisonExpanded] = useState(false);
  const [oneTimeDraftState, setOneTimeDraftState] = useState(() => ({
    sourceCurrency: currencyCode,
    value: formatEditableMoney(0, currencyCode),
  }));
  const oneTimeDraft = oneTimeDraftState.sourceCurrency === currencyCode
    ? oneTimeDraftState.value
    : formatEditableMoney(0, currencyCode);
  const setOneTimeDraft = useCallback((next: string | ((value: string) => string)) => {
    setOneTimeDraftState(current => {
      const currentValue = current.sourceCurrency === currencyCode
        ? current.value
        : formatEditableMoney(0, currencyCode);
      return {
        sourceCurrency: currencyCode,
        value: typeof next === 'function' ? next(currentValue) : next,
      };
    });
  }, [currencyCode]);
  const [oneTimeDate, setOneTimeDate] = useState<DateOnly>(() => currentHouseholdDate(householdTimeZone));
  const [showOneTimeDatePicker, setShowOneTimeDatePicker] = useState(false);
  const [oneTimeFocused, setOneTimeFocused] = useState(false);
  const [extraDraftState, setExtraDraftState] = useState(() => ({
    sourceAmount: extraMonthlyPayment,
    sourceCurrency: currencyCode,
    value: formatEditableMoney(extraMonthlyPayment, currencyCode),
  }));
  const draftMatchesSource = extraDraftState.sourceAmount === extraMonthlyPayment && extraDraftState.sourceCurrency === currencyCode;
  const extraDraft = draftMatchesSource ? extraDraftState.value : formatEditableMoney(extraMonthlyPayment, currencyCode);
  const setExtraDraft = useCallback((next: string | ((value: string) => string)) => {
    setExtraDraftState(current => {
      const currentValue = current.sourceAmount === extraMonthlyPayment && current.sourceCurrency === currencyCode
        ? current.value
        : formatEditableMoney(extraMonthlyPayment, currencyCode);
      return {
        sourceAmount: extraMonthlyPayment,
        sourceCurrency: currencyCode,
        value: typeof next === 'function' ? next(currentValue) : next,
      };
    });
  }, [extraMonthlyPayment, currencyCode]);
  const [strategyError, setStrategyError] = useState('');
  const [strategyBusy, setStrategyBusy] = useState(false);
  const [extraBusy, setExtraBusy] = useState(false);
  const [extraSaved, setExtraSaved] = useState(false);
  const [extraFocused, setExtraFocused] = useState(false);
  const [focusedMortgageId, setFocusedMortgageId] = useState<string | null>(null);
  const [savedMortgageId, setSavedMortgageId] = useState<string | null>(null);
  const [mortgageExtraDrafts, setMortgageExtraDrafts] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const extraInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const oneTimeInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const mortgageInputRefs = useRef<Record<string, ComponentRef<typeof TextInput> | null>>({});
  const extraDraftRef = useRef(extraDraft);
  const extraMonthlyPaymentRef = useRef(extraMonthlyPayment);
  const onExtraRef = useRef(onExtra);
  const currencyCodeRef = useRef(currencyCode);
  const extraInFlightRef = useRef<Promise<boolean> | null>(null);
  const extraPendingTargetRef = useRef<number | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mortgageExtraDraftsRef = useRef(mortgageExtraDrafts);
  const mortgageSavedByIdRef = useRef(mortgageExtraPaymentByDebtId);
  const onMortgageExtraRef = useRef(onMortgageExtra);
  const mortgageSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    extraDraftRef.current = extraDraft;
    extraMonthlyPaymentRef.current = extraMonthlyPayment;
    onExtraRef.current = onExtra;
    currencyCodeRef.current = currencyCode;
    mortgageExtraDraftsRef.current = mortgageExtraDrafts;
    mortgageSavedByIdRef.current = mortgageExtraPaymentByDebtId;
    onMortgageExtraRef.current = onMortgageExtra;
  }, [extraDraft, extraMonthlyPayment, onExtra, currencyCode, mortgageExtraDrafts, mortgageExtraPaymentByDebtId, onMortgageExtra]);

  const commitExtraPayment = useCallback(async (): Promise<boolean> => {
    if (!canEdit) return false;
    const raw = extraDraftRef.current;
    const parsed = validateExtraPaymentInput(raw, currencyCodeRef.current);
    if (!parsed.valid) {
      setStrategyError(parsed.error);
      return false;
    }
    const targetAmount = parsed.extraMonthlyPayment;
    setExtraDraft(formatEditableMoney(targetAmount, currencyCodeRef.current));
    setStrategyError('');

    if (extraInFlightRef.current) {
      if (extraPendingTargetRef.current === targetAmount) {
        return extraInFlightRef.current;
      }
      await extraInFlightRef.current.catch(() => false);
    }

    if (targetAmount === extraMonthlyPaymentRef.current) {
      return true;
    }
    if (!onExtraRef.current) return true;

    setExtraBusy(true);
    setExtraSaved(false);
    extraPendingTargetRef.current = targetAmount;
    const savePromise = (async () => {
      try {
        await onExtraRef.current!(targetAmount);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        setExtraSaved(true);
        savedTimerRef.current = setTimeout(() => setExtraSaved(false), 1600);
        return true;
      } catch (err) {
        setStrategyError(err instanceof Error ? err.message : 'Unable to save extra payment.');
        return false;
      } finally {
        if (extraPendingTargetRef.current === targetAmount) {
          extraPendingTargetRef.current = null;
        }
        extraInFlightRef.current = null;
        setExtraBusy(false);
      }
    })();
    extraInFlightRef.current = savePromise;
    return savePromise;
  }, [canEdit, setExtraDraft]);

  const commitMortgageExtra = async (debtId: string): Promise<boolean> => {
    if (!canEdit) return true;
    const raw = mortgageExtraDraftsRef.current[debtId];
    if (raw === undefined) return true;
    const parsed = validateExtraPaymentInput(raw, currencyCodeRef.current);
    if (!parsed.valid) {
      setStrategyError(parsed.error);
      return false;
    }
    const targetAmount = parsed.extraMonthlyPayment;
    setMortgageExtraDrafts(current => ({ ...current, [debtId]: formatEditableMoney(targetAmount, currencyCodeRef.current) }));
    setStrategyError('');
    if (targetAmount === (mortgageSavedByIdRef.current[debtId] ?? 0)) {
      return true;
    }
    if (!onMortgageExtraRef.current) return true;
    setExtraBusy(true);
    try {
      await onMortgageExtraRef.current(debtId, targetAmount);
      if (mortgageSavedTimerRef.current) clearTimeout(mortgageSavedTimerRef.current);
      setSavedMortgageId(debtId);
      mortgageSavedTimerRef.current = setTimeout(() => setSavedMortgageId(null), 1600);
      return true;
    } catch (error) {
      setStrategyError(error instanceof Error ? error.message : 'Unable to save mortgage extra payment.');
      return false;
    } finally {
      setExtraBusy(false);
    }
  };

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    if (mortgageSavedTimerRef.current) clearTimeout(mortgageSavedTimerRef.current);
  }, []);
  const { showInformation, informationSheet } = useInformationSheet();
  const [section, setSection] = useState<string>(detailSections[0]);
  const [txPeriod, setTxPeriod] = useState<string>(txPeriods[0]);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileInput, setReconcileInput] = useState('');
  const [reconcileReason, setReconcileReason] = useState<'interest_adjustment' | 'balance_adjustment' | 'credit_adjustment'>('interest_adjustment');
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileError, setReconcileError] = useState('');
  const [detailDraftOverride, setDetailDraftOverride] = useState<{ key: string; draft: DebtDetailsDraft } | null>(null);
  const [minimumModeByDebtId, setMinimumModeByDebtId] = useState<Record<string, 'auto' | 'manual'>>({});
  const [detailFocusedField, setDetailFocusedField] = useState<string | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailSaved, setDetailSaved] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [showDetailCategoryPicker, setShowDetailCategoryPicker] = useState(false);
  const [showDetailDuePicker, setShowDetailDuePicker] = useState(false);
  const [showDetailRenewalPicker, setShowDetailRenewalPicker] = useState(false);
  const [deleteConfirmDebt, setDeleteConfirmDebt] = useState<DebtItem | null>(null);
  const { opacity: detailFabOpacity, scrollHandlers: detailScrollHandlers } = useScrollFadeOpacity();
  const [showAccountTxModal, setShowAccountTxModal] = useState(false);
  const detailSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (detailSavedTimerRef.current) clearTimeout(detailSavedTimerRef.current);
  }, []);

  const resetDetailUiState = () => {
    setTimelineExpanded(false);
    setDetailDraftOverride(null);
    setDetailFocusedField(null);
    setDetailError('');
    setDetailSaved(false);
    setShowDetailCategoryPicker(false);
    setShowDetailDuePicker(false);
    setShowDetailRenewalPicker(false);
    setReconciling(false);
    setReconcileError('');
    setDeleteConfirmDebt(null);
    setShowAccountTxModal(false);
  };

  const openAccountTxModal = () => {
    if (!canEdit || !selected || !onAddTransaction) return;
    setShowAccountTxModal(true);
  };

  const closeAccountTxModal = useCallback(() => {
    setShowAccountTxModal(false);
  }, []);

  const [prevInitialId, setPrevInitialId] = useState(initialSelectedId);
  if (initialSelectedId !== prevInitialId) {
    setPrevInitialId(initialSelectedId);
    if (initialSelectedId !== undefined && initialSelectedId !== null) {
      resetDetailUiState();
      setSelectedId(initialSelectedId);
      setSection('Overview');
    }
  }

  const { isLight, isInspire, palette, ctaBg, ctaFg } = useNativeAppearance();
  const insets = useSafeAreaInsets();
  const isArchivedDebt = (item: DebtItem) => isPaidOffAccountArchived(item, archivedPaidOffDebtIds);
  const activeAccounts = useMemo(() => debts.filter(item => !isPaidOffAccountArchived(item, archivedPaidOffDebtIds)), [debts, archivedPaidOffDebtIds]);
  const archivedAccounts = useMemo(() => debts.filter(item => isPaidOffAccountArchived(item, archivedPaidOffDebtIds)), [debts, archivedPaidOffDebtIds]);
  const categoryAccounts = useMemo<Record<AccountFilter, DebtItem[]>>(() => ({
    All: activeAccounts,
    'Credit Cards': activeAccounts.filter(item => item.category === 'Credit card'),
    'Personal Loans': activeAccounts.filter(isPersonalLoan),
    Auto: activeAccounts.filter(item => item.category === 'Auto loan'),
    Home: activeAccounts.filter(item => item.category === 'Mortgage'),
    'Paid Off': archivedAccounts,
  }), [activeAccounts, archivedAccounts]);
  const visibleFilters = useMemo(() => accountFilterOrder.filter(value => value === 'All'
    || categoryAccounts[value].length > 0), [categoryAccounts]);
  useEffect(() => {
    if (!visibleFilters.includes(filter) && visibleFilters.length > 0) {
      setFilter(activeAccounts.length > 0 ? 'All' : archivedAccounts.length > 0 ? 'Paid Off' : 'All');
      // Clear the local input when its selected category disappears.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery('');
    }
  }, [filter, activeAccounts.length, archivedAccounts.length, visibleFilters]);
  const activeScoped = useMemo(
    () => categoryAccounts[filter].filter(item => !isPaidOffAccountArchived(item, archivedPaidOffDebtIds)),
    [categoryAccounts, filter, archivedPaidOffDebtIds],
  );
  const scopedAccountCount = filter === 'Paid Off' ? categoryAccounts['Paid Off'].length : activeScoped.length;
  const scopedAccountCountLabel = filter === 'Paid Off'
    ? `${scopedAccountCount} paid-off ${scopedAccountCount === 1 ? 'account' : 'accounts'}`
    : `${scopedAccountCount} active ${scopedAccountCount === 1 ? 'account' : 'accounts'}`;
  const stats = snapshot(activeScoped);
  // Invalidate the cached projections when the household date rolls over.
  const projectionDay = currentHouseholdDate(householdTimeZone);
  const oneTimeCycleInfo = useMemo(
    () => resolveOneTimePaymentPeriod(oneTimeDate, new Date(), householdTimeZone),
    // Invalidate on household date rollover alongside inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [oneTimeDate, householdTimeZone, projectionDay],
  );
  const savedStrategyComparison = useMemo(
    () => comparePayoffStrategies(
      debts,
      strategy,
      extraMonthlyPayment,
      new Date(),
      currencyCode,
      householdTimeZone,
      archivedPaidOffDebtIds,
    ),
    // Invalidate on household date rollover alongside inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debts, strategy, extraMonthlyPayment, currencyCode, householdTimeZone, archivedPaidOffDebtIds, projectionDay],
  );
  const monthlyParsed = useMemo(() => parseMoneyDraft(extraDraft, currencyCode), [extraDraft, currencyCode]);
  const oneTimeParsed = useMemo(() => parseMoneyDraft(oneTimeDraft, currencyCode), [oneTimeDraft, currencyCode]);
  const scenarioValid = monthlyParsed.valid && oneTimeParsed.valid;
  const previewMonthlyAmount = monthlyParsed.valid ? monthlyParsed.amount : extraMonthlyPayment;
  const previewOneTimeAmount = oneTimeParsed.valid ? oneTimeParsed.amount : 0;
  const strategyComparison = useMemo(
    () => comparePayoffStrategies(
      debts,
      strategy,
      previewMonthlyAmount,
      new Date(),
      currencyCode,
      householdTimeZone,
      archivedPaidOffDebtIds,
      previewOneTimeAmount,
      oneTimeCycleInfo.period,
    ),
    // Invalidate on household date rollover alongside inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      debts,
      strategy,
      previewMonthlyAmount,
      currencyCode,
      householdTimeZone,
      archivedPaidOffDebtIds,
      previewOneTimeAmount,
      oneTimeCycleInfo.period,
      projectionDay,
    ],
  );
  const scenarioComparison = useMemo(() => calculateStrategyScenario({
    debts,
    strategy,
    baselineExtraMonthlyPayment: extraMonthlyPayment,
    monthlyExtraAmount: previewMonthlyAmount,
    oneTimeExtraAmount: previewOneTimeAmount,
    oneTimeDate,
    baseDate: new Date(),
    currencyCode,
    householdTimeZone,
    archivedPaidOffDebtIds,
  // Invalidate on household date rollover alongside inputs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    debts,
    strategy,
    extraMonthlyPayment,
    previewMonthlyAmount,
    previewOneTimeAmount,
    oneTimeDate,
    currencyCode,
    householdTimeZone,
    archivedPaidOffDebtIds,
    projectionDay,
  ]);
  const extraStepAmount = getCurrency(currencyCode).scale === 0 ? 5000 : 50;
  const stepScenarioAmount = (
    parsed: { valid: boolean; amount: number },
    fallbackAmount: number,
    delta: number,
    setter: (next: string) => void,
  ) => {
    extraInputRef.current?.blur();
    oneTimeInputRef.current?.blur();
    Keyboard.dismiss();
    const base = parsed.valid ? parsed.amount : fallbackAmount;
    const next = Math.max(0, roundToCurrencyScale(base + delta, currencyCode));
    if (strategyError) setStrategyError('');
    setExtraSaved(false);
    setter(formatEditableMoney(next, currencyCode));
  };
  const mortgageDebts = useMemo(() => debts.filter(item => item.category === 'Mortgage'), [debts]);
  const mortgagePlans = useMemo(
    () => calculateIndependentMortgageProjections(
      debts,
      strategy,
      mortgageEscrowByDebtId,
      mortgageExtraPaymentByDebtId,
      new Date(),
      currencyCode,
      householdTimeZone,
    ),
    // Invalidate on household date rollover alongside inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debts, strategy, mortgageEscrowByDebtId, mortgageExtraPaymentByDebtId, currencyCode, householdTimeZone, projectionDay],
  );
  const mortgageProjectionById = useMemo(
    () => new Map(mortgagePlans.map(row => [row.debt.id, row.projection])),
    [mortgagePlans],
  );
  const planProjectionById = useMemo(
    () => new Map((plan.allProjections ?? plan.payoffOrder).map(item => [item.id, item])),
    [plan],
  );
  const projectionFor = useCallback(
    (debt: DebtItem) => (debt.category === 'Mortgage' ? mortgageProjectionById.get(debt.id) : planProjectionById.get(debt.id)),
    [mortgageProjectionById, planProjectionById],
  );
  const visible = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    return categoryAccounts[filter]
      .filter(d => d.name.toLowerCase().includes(normalizedQuery))
      .sort((a, b) =>
        sort === 0 ? a.name.localeCompare(b.name)
          : sort === 1 ? b.balance - a.balance
            : sort === 2 ? b.apr - a.apr
              : ((projectionFor(a)?.monthsToPayoff ?? Infinity) - (projectionFor(b)?.monthsToPayoff ?? Infinity)),
      );
  }, [categoryAccounts, filter, query, sort, projectionFor]);
  const visibleActive = useMemo(
    () => visible.filter(item => !isPaidOffAccountArchived(item, archivedPaidOffDebtIds)),
    [visible, archivedPaidOffDebtIds],
  );
  const visibleArchived = useMemo(
    () => visible.filter(item => isPaidOffAccountArchived(item, archivedPaidOffDebtIds)),
    [visible, archivedPaidOffDebtIds],
  );
  const visibleGroups = useMemo(
    () => (filter === 'All'
      ? [
          { label: 'Credit Cards', items: visibleActive.filter(item => item.category === 'Credit card') },
          { label: 'Personal Loans', items: visibleActive.filter(isPersonalLoan) },
          { label: 'Auto', items: visibleActive.filter(item => item.category === 'Auto loan') },
          { label: 'Home', items: visibleActive.filter(item => item.category === 'Mortgage') },
        ]
      : [{ label: filter, items: visibleActive }]),
    [filter, visibleActive],
  );
  const renderAccountCard = (item: DebtItem, archived = false, cardIndex = 0) => {
    const itemProjection = projectionFor(item);
    const rawPayoff = itemProjection?.projectedPayoffLabel ?? '—';
    const payoffLabel = rawPayoff === '—' || rawPayoff.startsWith('Est.') || /unavailable|no /i.test(rawPayoff)
      ? rawPayoff
      : `Est. ${rawPayoff}`;
    const payoffText = payoffLabel.replace(/ /g, '\u00a0');
    const reduction = getAccountReductionDisplay(item, archived, palette);
    const artKind: InspireArtKind = archived
      ? (cardIndex % 2 === 0 ? 'corner-leaf' : 'corner-wave')
      : item.category === 'Mortgage'
        ? 'corner-ridge'
        : item.category === 'Auto loan'
          ? 'corner-leaf'
          : (cardIndex % 2 === 0 ? 'corner-wave' : 'corner-ridge');
    return (
      <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name} account details${archived ? ', archived paid off account' : ''}`}
        onPress={() => { resetDetailUiState(); setMarkPaidError(''); setSelectedId(item.id); setSection('Overview'); }}
      >
        <Card style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, gap: 7, overflow: 'hidden' }}>
          {isInspire ? <InspireCornerArt kind={artKind} borderRadius={16} /> : null}
          <View style={[ui.row, { gap: 12, alignItems: 'center' }]}>
            <AccountMark name={item.name} category={item.category} size={38} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text numberOfLines={1} style={[ui.heading, { fontSize: 15.5 }]}>{item.name}</Text>
              <Text style={ui.small} numberOfLines={1}>
                {archived ? 'Paid off · history retained' : <>{item.category} · <Text style={{ color: item.apr < 15 ? palette.posInk : palette.neg }}>{item.apr.toFixed(2)}%</Text> APR</>}
              </Text>
            </View>
            <View style={[ui.row, { gap: 6, alignItems: 'center', maxWidth: '46%', minWidth: 0 }]}>
              <AmountText style={[ui.value, { fontSize: 16.5, fontWeight: '800', color: archived ? palette.posInk : palette.text, textAlign: 'right' }]} value={formatCurrency(item.balance, currencySymbol)} />
              <AppIcon name="chevronRight" size={16} color={palette.muted} />
            </View>
          </View>
          <AccountBalanceTrack percent={reduction.trackPercent} />
          <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
            <Text style={[ui.small, { color: reduction.color, fontWeight: '700' }]}>
              {reduction.label}
            </Text>
            <Text numberOfLines={1} style={[ui.small, { color: palette.muted, fontWeight: '600' }]}>
              {archived ? 'Archived' : payoffText}
            </Text>
          </View>
        </Card>
      </Pressable>
    );
  };
  const selected = debts.find(item => item.id === selectedId) ?? null;
  const selectedEscrow = selected ? mortgageEscrowByDebtId[selected.id] : undefined;
  const expectedDetailKey = selected
    ? `${selected.id}:${selected.updatedAt}:${selected.serverVersion ?? ''}:${selectedEscrow ?? ''}:${selected.balance}:${selected.apr}:${selected.minimumPayment}:${selected.name}:${selected.category}:${selected.dueDay ?? ''}:${selected.originalBalance ?? ''}:${selected.creditLimit ?? ''}:${selected.annualFeeAmount ?? ''}:${selected.annualFeeNextDueDate ?? ''}:${currencyCode}`
    : '';
  const baseDetailDraft: DebtDetailsDraft = selected
    ? {
        category: selected.category,
        name: selected.name,
        balance: formatEditableMoney(selected.balance, currencyCode),
        originalBalance: selected.originalBalance !== null ? formatEditableMoney(selected.originalBalance, currencyCode) : '',
        apr: String(selected.apr),
        minimumPayment: formatEditableMoney(selected.minimumPayment, currencyCode),
        minimumMode: minimumModeByDebtId[selected.id] ?? 'manual',
        mortgageEscrow: selectedEscrow !== undefined ? formatEditableMoney(selectedEscrow, currencyCode) : '',
        dueDay: selected.dueDay !== null ? String(selected.dueDay) : '',
        creditLimit: selected.creditLimit !== null ? formatEditableMoney(selected.creditLimit, currencyCode) : '',
        annualFeeAmount: selected.annualFeeAmount != null ? formatEditableMoney(selected.annualFeeAmount, currencyCode) : '',
        annualFeeNextDate: selected.annualFeeNextDueDate ?? '',
      }
    : {
        category: 'Credit card',
        name: '',
        balance: '',
        originalBalance: '',
        apr: '',
        minimumPayment: '',
        minimumMode: 'manual',
        mortgageEscrow: '',
        dueDay: '',
        creditLimit: '',
        annualFeeAmount: '',
        annualFeeNextDate: '',
      };
  const detailDraft = detailDraftOverride && detailDraftOverride.key === expectedDetailKey
    ? detailDraftOverride.draft
    : baseDetailDraft;
  const updateDetailDraft = (updater: (prev: DebtDetailsDraft) => DebtDetailsDraft) => {
    if (detailError) setDetailError('');
    if (detailSaved) setDetailSaved(false);
    setDetailDraftOverride(prev => {
      const current = prev && prev.key === expectedDetailKey ? prev.draft : baseDetailDraft;
      return { key: expectedDetailKey, draft: updater(current) };
    });
  };
  const detailParsedBalance = parseMoneyInput(detailDraft.balance, currencyCode, true);
  const detailParsedApr = parsePercentInput(detailDraft.apr);
  const detailAutoEstimatedMin = detailParsedBalance !== null && detailParsedBalance > 0
    ? estimateMinimumPayment(detailParsedBalance, detailParsedApr !== null && detailParsedApr >= 0 ? detailParsedApr : 0, currencyCode)
    : 0;
  const detailDirty = selected ? (
    detailDraft.name !== selected.name ||
    detailDraft.category !== selected.category ||
    detailDraft.balance !== formatEditableMoney(selected.balance, currencyCode) ||
    detailDraft.originalBalance !== (selected.originalBalance !== null ? formatEditableMoney(selected.originalBalance, currencyCode) : '') ||
    detailDraft.apr !== String(selected.apr) ||
    (detailDraft.minimumMode === 'auto'
      ? detailAutoEstimatedMin !== selected.minimumPayment
      : detailDraft.minimumPayment !== formatEditableMoney(selected.minimumPayment, currencyCode)) ||
    detailDraft.mortgageEscrow !== (selectedEscrow !== undefined ? formatEditableMoney(selectedEscrow, currencyCode) : '') ||
    detailDraft.dueDay !== (selected.dueDay !== null ? String(selected.dueDay) : '') ||
    detailDraft.creditLimit !== (selected.creditLimit !== null ? formatEditableMoney(selected.creditLimit, currencyCode) : '') ||
    detailDraft.annualFeeAmount !== (selected.annualFeeAmount != null ? formatEditableMoney(selected.annualFeeAmount, currencyCode) : '') ||
    detailDraft.annualFeeNextDate !== (selected.annualFeeNextDueDate ?? '')
  ) : false;

  const saveDetailChanges = async () => {
    if (!canEdit || !selected || !onSaveDebtDetails || detailSaving) return;
    Keyboard.dismiss();
    setDetailSaving(true);
    setDetailError('');
    try {
      const modeToSave = detailDraft.minimumMode;
      const saved = await onSaveDebtDetails(selected.id, detailDraft);
      if (saved) {
        setMinimumModeByDebtId(prev => ({ ...prev, [selected.id]: modeToSave }));
        setDetailSaved(true);
        if (detailSavedTimerRef.current) clearTimeout(detailSavedTimerRef.current);
        detailSavedTimerRef.current = setTimeout(() => setDetailSaved(false), 1800);
      }
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Unable to save account details.');
    } finally {
      setDetailSaving(false);
    }
  };

  const identityLinkedPairs = uniqueHistoricalBillIdByDebtId(loanBillPairings);
  const allHistoricalBillIds = historicalBillIdsByDebtId(loanBillPairings);
  const selectedPairing = selected ? loanBillPairings[selected.id] : undefined;
  const selectedLinkedBillId = selected ? identityLinkedPairs[selected.id] : undefined;
  const selectedLinkedBillIds = selected
    ? Array.from(new Set([
        selectedLinkedBillId,
        selectedPairing?.billId,
        ...(allHistoricalBillIds[selected.id] ?? []),
      ].filter((value): value is string => Boolean(value))))
    : [];
  const accountTransactions = selected ? transactions
    .filter(tx => tx.deletedAt === null && (tx.accountId === selected.id || Boolean(tx.accountId === null && selectedLinkedBillId && transactionHasBillId(tx, selectedLinkedBillId))))
    .sort((a, b) => b.date.localeCompare(a.date)) : [];
  const projection = selected ? projectionFor(selected) : undefined;
  const selectedLinkedBill = selectedLinkedBillId ? recurringBills.find(bill => bill.id === selectedLinkedBillId) : undefined;
  const startReconcile = () => {
    if (!canEdit || !selected) return;
    setReconcileInput(formatEditableMoney(selected.balance, currencyCode));
    setReconcileReason('interest_adjustment');
    setReconcileError('');
    setReconciling(true);
  };
  const saveReconcile = async () => {
    if (!canEdit || !selected || reconcileBusy) return;
    const parsed = parseMoneyInput(reconcileInput, currencyCode, true);
    if (parsed === null || parsed < 0) {
      setReconcileError('Please enter a valid statement balance');
      return;
    }
    setReconcileBusy(true);
    setReconcileError('');
    try {
      if (onReconcile) {
        const res = await onReconcile(selected, parsed, reconcileReason);
        if (res && (res as { outcome?: string }).outcome === 'pending') {
          Alert.alert(
            'Reconciled Locally (Pending Confirmation)',
            'Account balance updated locally. Confirmation will be verified upon connecting to the server.',
          );
        }
      }
      setReconciling(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reconciliation failed.';
      setReconcileError(msg);
      if (msg.includes('conflict') || msg.includes('Conflict')) {
        Alert.alert('Reconciliation Conflict', msg);
      }
    } finally {
      setReconcileBusy(false);
    }
  };
  const backToAccounts = () => { setSelectedId(null); resetDetailUiState(); onDismiss?.(); };

  const markSelectedAsPaid = async () => {
    if (!canEdit || !selected || selected.balance !== 0 || isArchivedDebt(selected) || !onMarkPaid || markPaidBusy) return;
    setMarkPaidBusy(true);
    setMarkPaidError('');
    try {
      await onMarkPaid(selected.id);
      setFilter('Paid Off');
      setQuery('');
      backToAccounts();
    } catch (err) {
      setMarkPaidError(err instanceof Error ? err.message : 'Unable to archive this paid-off account.');
    } finally {
      setMarkPaidBusy(false);
    }
  };

  const filterOptions = visibleFilters.map(value => ({
    value,
    label: value === 'All' ? `All (${activeAccounts.length})` : value,
  }));

  const parsedReconcile = parseMoneyInput(reconcileInput, currencyCode, true);
  const drift = selected ? (parsedReconcile ?? 0) - selected.balance : 0;

  return (
    <>
    <FinancialScreen
      title="Accounts"
      segments={['Accounts', 'Strategy']}
      selected={view}
      onSelect={value => {
        const nextView = value === 'Strategy' ? 'Strategy' : 'Accounts';
        if (nextView !== 'Strategy') {
          extraInputRef.current?.blur();
          oneTimeInputRef.current?.blur();
          if (focusedMortgageId) mortgageInputRefs.current[focusedMortgageId]?.blur();
          Keyboard.dismiss();
          if (focusedMortgageId) void commitMortgageExtra(focusedMortgageId);
        }
        setView(nextView);
        if (nextView !== 'Accounts') {
          setSelectedId(null);
          resetDetailUiState();
        }
      }}
      onSettings={onSettings}
      onAdd={canEdit && !editor && !editorOpen && view === 'Accounts' ? onAdd : undefined}
      addLabel="Add Debt Account"
      renderSegment={segment => (segment === 'Accounts' ? <>
      {!canEdit ? (
        <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.tint }}>
          <Text style={[ui.small, { color: palette.text, fontWeight: '600' }]}>View-only access · You can inspect accounts and payoff projections, while edits are disabled for Viewers.</Text>
        </View>
      ) : null}
      <View style={{
        position: 'relative',
        minHeight: 132,
        paddingHorizontal: 17,
        paddingVertical: 16,
        borderRadius: 18,
        backgroundColor: palette.hero,
        borderWidth: isInspire ? 1.5 : 1,
        borderColor: palette.heroBorder,
        justifyContent: 'space-between',
        gap: 6,
        overflow: 'hidden',
      }}>
        <HeroGradient borderRadius={18} kind="hero-accounts" />
        {!isInspire ? <HeroOrbit /> : null}
        <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
          <Text style={[ui.small, { color: palette.heroSecondary, fontWeight: '600' }]}>{filter === 'All' ? 'Total Balance' : filter}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="About balance snapshot" hitSlop={8} onPress={() => showInformation('Balance snapshot', 'Balance change compares current balances with the higher of each current and entered original balance. It may include corrections or credits and is not recorded payment history.')}>
            <AppIcon name="info" size={15} color={palette.onHero} />
          </Pressable>
        </View>
        <AmountText style={[ui.title, { fontSize: 32, color: palette.onHero, letterSpacing: -0.8 }]} value={formatCurrency(stats.balance, currencySymbol)} />
        <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
          <Text style={[ui.small, { color: palette.heroSecondary, fontWeight: '500' }]}>{scopedAccountCountLabel}</Text>
          {isInspire ? (
            <InspireQuote slot="accountsRight" color={palette.heroSecondary} style={{ fontSize: 12 }} />
          ) : (
            <Text style={[ui.small, { color: palette.heroSecondary, fontWeight: '500' }]}>
              {filter === 'All' ? 'All active categories' : filter}
            </Text>
          )}
        </View>
      </View>
      <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
        {searchOpen ? (
          <View style={[ui.row, { width: 150, flexShrink: 0, minHeight: 40, gap: 6, paddingLeft: 10, paddingRight: 4, backgroundColor: palette.surface, borderWidth: isInspire ? 1.5 : 1, borderColor: palette.cardBorder, borderRadius: 12 }]}>
            <AppIcon name="search" size={16} color={palette.muted} />
            <TextInput accessibilityLabel="Search accounts" placeholder="Search" placeholderTextColor={palette.muted} value={searchInput} onChangeText={setQuery} onBlur={() => flushSearch(searchInput)} onSubmitEditing={() => flushSearch(searchInput)} autoFocus style={{ color: palette.text, fontSize: 14, flex: 1, minWidth: 0, minHeight: 38, paddingHorizontal: 2, borderWidth: 0, backgroundColor: 'transparent' }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Close account search" hitSlop={8} onPress={() => { setSearchOpen(false); clearSearch(); Keyboard.dismiss(); }} style={{ width: 30, height: 38, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name="close" size={16} color={palette.muted} />
            </Pressable>
          </View>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Search accounts" onPress={() => setSearchOpen(true)} style={[ui.button, { width: 40, height: 40, flexShrink: 0, borderRadius: 12, backgroundColor: palette.surface, borderWidth: isInspire ? 1.5 : 1, borderColor: palette.cardBorder, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 0 }]}>
            <AppIcon name="search" size={18} color={palette.accentInk} />
          </Pressable>
        )}
        <SwipeProtectedHorizontalArea style={{ flex: 1, minWidth: 0, position: 'relative', justifyContent: 'center' }}>
          <ScrollView
            horizontal
            nestedScrollEnabled
            style={{ width: '100%' }}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 4 }}
            scrollEventThrottle={16}
            onLayout={event => {
              const width = event.nativeEvent.layout.width;
              setCatScrollMetrics(prev => (prev.containerWidth === width ? prev : { ...prev, containerWidth: width }));
            }}
            onContentSizeChange={contentWidth => {
              setCatScrollMetrics(prev => (prev.contentWidth === contentWidth ? prev : { ...prev, contentWidth }));
            }}
            onScroll={event => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              setCatScrollMetrics({
                offsetX: Math.max(0, contentOffset.x),
                contentWidth: contentSize.width,
                containerWidth: layoutMeasurement.width,
              });
            }}
          >
            {filterOptions.map(option => {
              const active = filter === option.value;
              return <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { setFilter(option.value); setQuery(''); setMarkPaidError(''); }} style={{ flexShrink: 0, minHeight: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: isInspire || active ? 1.5 : 1, borderColor: active ? (isInspire ? (isLight ? 'rgba(255,255,255,0.45)' : 'rgba(9,13,20,0.35)') : ctaBg) : palette.cardBorder, backgroundColor: active ? ctaBg : palette.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Text numberOfLines={1} style={{ color: active ? ctaFg : palette.text, fontSize: 13.5, fontWeight: '700' }}>{option.label}</Text>
              </Pressable>;
            })}
          </ScrollView>
          {canScrollCatLeft ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 24, zIndex: 2 }}>
              <Svg width="100%" height="100%">
                <Defs>
                  <LinearGradient id={`${catFadeIdPrefix}_catLeftFade`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <Stop offset="0%" stopColor={palette.canvas} stopOpacity="1" />
                    <Stop offset="100%" stopColor={palette.canvas} stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${catFadeIdPrefix}_catLeftFade)`} />
              </Svg>
            </View>
          ) : null}
          {canScrollCatRight ? (
            <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 24, zIndex: 2 }}>
              <Svg width="100%" height="100%">
                <Defs>
                  <LinearGradient id={`${catFadeIdPrefix}_catRightFade`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <Stop offset="0%" stopColor={palette.canvas} stopOpacity="0" />
                    <Stop offset="100%" stopColor={palette.canvas} stopOpacity="1" />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${catFadeIdPrefix}_catRightFade)`} />
              </Svg>
            </View>
          ) : null}
        </SwipeProtectedHorizontalArea>
      </View>
      {!!error && !editor && !editorOpen && !selected && <Text accessibilityRole="alert" style={ui.text}>{error}</Text>}
      {visible.length === 0 && <View style={{ paddingVertical: 24, paddingHorizontal: 16 }}><Text style={ui.heading}>{query ? 'No matching accounts' : 'No accounts in this category'}</Text></View>}
      {visibleGroups.filter(group => group.items.length > 0).map((group, groupIndex) => {
        const groupItems = group.items;
        return <View key={group.label} style={{ marginTop: 6, gap: 10 }}>
          <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 }]}>
            <Text style={[ui.small, { flex: 1, fontWeight: '700', letterSpacing: 0.2 }]}>{group.label}</Text>
            {groupIndex === 0 ? (
              <SelectDropdown compact accessibilityLabel="Sort debts" value={sort} options={sortOptions} onSelect={setSort} sheetTitle="Sort debt accounts" style={{ width: 110 }} />
            ) : null}
          </View>
          {groupItems.map((item, cardIndex) => renderAccountCard(item, false, cardIndex))}
        </View>;
      })}
      {filter === 'Paid Off' && visibleArchived.length > 0 && <View style={{ marginTop: 8, gap: 10 }}>
        <View style={[ui.row, { justifyContent: 'space-between', paddingHorizontal: 2 }]}>
          <Text style={[ui.small, { flex: 1, fontWeight: '700', letterSpacing: 0.2 }]}>Archived · Paid Off</Text>
          <SelectDropdown compact accessibilityLabel="Sort debts" value={sort} options={sortOptions} onSelect={setSort} sheetTitle="Sort debt accounts" style={{ width: 110 }} />
        </View>
        {visibleArchived.map((item, cardIndex) => renderAccountCard(item, true, cardIndex))}
      </View>}
      </> : segment === 'Strategy' ? (
        <Pressable
          accessible={false}
          disabled={!extraFocused && !oneTimeFocused && !focusedMortgageId}
          onPress={() => {
            extraInputRef.current?.blur();
            oneTimeInputRef.current?.blur();
            if (focusedMortgageId) mortgageInputRefs.current[focusedMortgageId]?.blur();
            Keyboard.dismiss();
          }}
          style={{ gap: 12 }}
        >
        {!canEdit ? (
          <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.tint }}>
            <Text style={[ui.small, { color: palette.text, fontWeight: '600' }]}>View-only access · Strategy changes are disabled for Viewers.</Text>
          </View>
        ) : null}
        {strategyType === 'Debt strategy' ? (
          <View style={{
            position: 'relative',
            minHeight: 132,
            backgroundColor: palette.hero,
            borderRadius: 18,
            borderWidth: isInspire ? 1.5 : 1,
            borderColor: palette.heroBorder,
            paddingHorizontal: 17,
            paddingVertical: 16,
            justifyContent: 'space-between',
            gap: 4,
            overflow: 'hidden',
          }}>
            <HeroGradient borderRadius={18} kind="hero-strategy" />
            {!isInspire ? <HeroOrbit /> : null}
            <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <Text style={{ color: palette.heroSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.7 }}>ESTIMATED PAYOFF</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="About estimated payoff"
                hitSlop={8}
                onPress={() => {
                  const vsMinNote = plan.monthsToPayoff !== null && (
                    savedStrategyComparison.monthsSavedVsMinimums !== null || savedStrategyComparison.interestSavedVsMinimums !== null || savedStrategyComparison.minimumsOnly.stalled
                  )
                    ? (savedStrategyComparison.minimumsOnly.stalled
                      ? '\n\nMinimums only cannot pay off these balances — your active plan clears them.'
                      : (savedStrategyComparison.monthsSavedVsMinimums ?? 0) > 0 || (savedStrategyComparison.interestSavedVsMinimums ?? 0) > 0
                        ? `\n\nVs. minimums only: saves ${savedStrategyComparison.monthsSavedVsMinimums ?? 0} ${savedStrategyComparison.monthsSavedVsMinimums === 1 ? 'month' : 'months'} & ${formatCurrency(savedStrategyComparison.interestSavedVsMinimums ?? 0, currencySymbol)} interest.`
                        : `\n\nEst. total interest: ${formatCurrency(plan.totalInterest, currencySymbol)}.`)
                    : '';
                  showInformation(
                    'Estimated Payoff',
                    `Estimated from active strategy assumptions. Does not infer payoff from unallocated loan payments.${vsMinNote}`,
                  );
                }}
              >
                <AppIcon name="info" size={16} color={palette.onHero} />
              </Pressable>
            </View>
            <Text style={{ color: palette.onHero, fontSize: 31, fontWeight: '800', letterSpacing: -0.7 }}>{homeDebtFreeEstimateDate(plan.debtFreeDateLabel)}</Text>
            <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <Text style={[ui.small, { color: palette.heroSecondary, fontSize: 13.5, fontWeight: '600' }]}>{plan.monthsToPayoff === null ? 'No payoff date' : `${plan.monthsToPayoff} months`}</Text>
              <View style={{
                paddingHorizontal: 11,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: isInspire ? (isLight ? 'rgba(255,255,255,0.78)' : 'rgba(45,212,191,0.16)') : 'rgba(255,255,255,0.18)',
                borderWidth: isInspire ? 1.5 : 1,
                borderColor: isInspire ? palette.brand : 'rgba(255,255,255,0.28)',
              }}>
                <Text style={{ color: isInspire ? palette.accentInk : palette.onHero, fontSize: 12, fontWeight: '700' }}>{strategy === 'snowball' ? 'Snowball' : 'Avalanche'}</Text>
              </View>
            </View>
          </View>
        ) : (() => {
          const activeMortgages = mortgageDebts.filter(item => item.balance > 0);
          const totalMortgageBalance = activeMortgages.reduce((sum, item) => sum + item.balance, 0);
          return (
            <View style={{
              position: 'relative',
              minHeight: 132,
              backgroundColor: palette.hero,
              borderRadius: 18,
              borderWidth: isInspire ? 1.5 : 1,
              borderColor: palette.heroBorder,
              paddingHorizontal: 17,
              paddingVertical: 16,
              justifyContent: 'space-between',
              gap: 4,
              overflow: 'hidden',
            }}>
              <HeroGradient borderRadius={18} kind="hero-strategy" />
              {!isInspire ? <HeroOrbit /> : null}
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                <Text style={{ color: palette.heroSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.7 }}>MORTGAGE STRATEGY</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="About mortgage strategy" hitSlop={8} onPress={() => showInformation('Mortgage strategy', 'Each mortgage is projected separately. Extra payments stay with that account; escrow is excluded from principal and interest.')}>
                  <AppIcon name="info" size={16} color={palette.onHero} />
                </Pressable>
              </View>
              <AmountText style={{ color: palette.onHero, fontSize: 30, fontWeight: '800', letterSpacing: -0.7 }} value={activeMortgages.length ? formatCurrency(totalMortgageBalance, currencySymbol) : 'No active mortgages'} />
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                <Text style={[ui.small, { color: palette.heroSecondary, fontSize: 13.5, fontWeight: '600' }]}>{`${activeMortgages.length} active ${activeMortgages.length === 1 ? 'mortgage' : 'mortgages'}`}</Text>
                <View style={{
                  paddingHorizontal: 11,
                  paddingVertical: 4,
                  borderRadius: 999,
                  backgroundColor: isInspire ? (isLight ? 'rgba(255,255,255,0.78)' : 'rgba(45,212,191,0.16)') : 'rgba(255,255,255,0.18)',
                  borderWidth: isInspire ? 1.5 : 1,
                  borderColor: isInspire ? palette.brand : 'rgba(255,255,255,0.28)',
                }}>
                  <Text style={{ color: isInspire ? palette.accentInk : palette.onHero, fontSize: 12, fontWeight: '700' }}>Escrow excluded</Text>
                </View>
              </View>
            </View>
          );
        })()}
        <View style={[ui.row, { gap: 8 }]}>
          {(['Debt strategy', 'Mortgage strategy'] as const).map(value => {
            const active = strategyType === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  extraInputRef.current?.blur();
                  oneTimeInputRef.current?.blur();
                  if (focusedMortgageId) mortgageInputRefs.current[focusedMortgageId]?.blur();
                  Keyboard.dismiss();
                  if (focusedMortgageId) void commitMortgageExtra(focusedMortgageId);
                  setStrategyType(value);
                }}
                style={{
                  flex: 1,
                  minHeight: 38,
                  paddingHorizontal: 12,
                  borderRadius: 19,
                  borderWidth: isInspire || active ? 1.5 : 1,
                  borderColor: active ? (isInspire ? (isLight ? 'rgba(255,255,255,0.45)' : 'rgba(9,13,20,0.35)') : ctaBg) : palette.cardBorder,
                  backgroundColor: active ? ctaBg : palette.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text numberOfLines={1} style={{ color: active ? ctaFg : palette.text, fontSize: 13.5, fontWeight: '700' }}>{value}</Text>
              </Pressable>
            );
          })}
        </View>
        {strategyType === 'Debt strategy' ? <>
          <View style={[ui.row, { gap: 10 }]}>
            {(['snowball', 'avalanche'] as const).map(value => {
              const selectedMethod = strategy === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedMethod }}
                  disabled={!canEdit || strategyBusy || extraBusy || !onStrategy}
                  onPress={() => {
                    if (!canEdit) return;
                    void (async () => {
                      extraInputRef.current?.blur();
                      oneTimeInputRef.current?.blur();
                      Keyboard.dismiss();
                      if (!onStrategy || strategyBusy) return;
                      setStrategyBusy(true); setStrategyError('');
                      try {
                        await onStrategy(value);
                      } catch (err) {
                        setStrategyError(err instanceof Error ? err.message : 'Unable to save payoff strategy.');
                      } finally {
                        setStrategyBusy(false);
                      }
                    })();
                  }}
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    flex: 1,
                    minHeight: 58,
                    paddingHorizontal: 13,
                    paddingVertical: 10,
                    gap: 3,
                    justifyContent: 'center',
                    borderRadius: 15,
                    borderWidth: selectedMethod ? 1.8 : (isInspire ? 1.5 : 1),
                    borderColor: selectedMethod ? palette.brand : palette.cardBorder,
                    backgroundColor: selectedMethod ? palette.selection : palette.surface,
                    opacity: !canEdit || strategyBusy ? 0.65 : 1,
                  }}
                >
                  {isInspire ? <InspireCornerArt kind={value === 'snowball' ? 'corner-wave' : 'corner-ridge'} borderRadius={15} /> : null}
                  <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                    <AppIcon name={value === 'snowball' ? 'bolt' : 'progress'} size={16} color={palette.accentInk} />
                    <Text numberOfLines={1} style={[ui.buttonText, { color: palette.text, fontSize: 15, textAlign: 'left', flexShrink: 1 }]}>
                      {value === 'snowball' ? 'Snowball' : 'Avalanche'}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={[ui.small, { textAlign: 'left' }]}>
                    {value === 'snowball' ? 'Smallest balance first' : 'Highest APR first'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Card style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderRadius: 16, overflow: 'hidden' }}>
            {isInspire ? <InspireCornerArt kind="corner-leaf" borderRadius={16} /> : null}
            <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 8 }]}>
              <Text style={ui.heading}>Extra payment</Text>
              <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
                {extraBusy ? (
                  <Text style={[ui.small, { color: palette.brand, fontWeight: '600' }]}>Saving…</Text>
                ) : extraSaved ? (
                  <Text style={[ui.small, { color: palette.brand, fontWeight: '600' }]}>Saved</Text>
                ) : monthlyParsed.valid && monthlyParsed.amount !== extraMonthlyPayment ? (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.raised, borderWidth: 1, borderColor: palette.border }}>
                    <Text style={[ui.small, { fontSize: 11, fontWeight: '700', color: palette.muted }]}>Unsaved</Text>
                  </View>
                ) : null}
                <InfoButton
                  label="Extra payment"
                  detail="Save monthly plan updates your recurring amount. The one-time amount and date update the local estimate for the selected monthly cycle."
                />
              </View>
            </View>
            <View style={{ gap: 12 }}>
              <ExtraAmountRow
                label="Extra monthly payment"
                rawDraft={extraDraft}
                focused={extraFocused}
                editable={!extraBusy}
                unitLabel="/ mo"
                inputAccessibilityLabel="Monthly extra payment amount"
                minusAccessibilityLabel="Decrease monthly extra payment"
                plusAccessibilityLabel="Increase monthly extra payment"
                clearAccessibilityLabel="Clear monthly extra payment"
                inputRef={extraInputRef}
                canDecrement={(monthlyParsed.valid ? monthlyParsed.amount : extraMonthlyPayment) > 0}
                currencyCode={currencyCode}
                currencySymbol={currencySymbol}
                onFocus={() => {
                  setExtraFocused(true);
                  setExtraSaved(false);
                }}
                onBlur={() => setExtraFocused(false)}
                onChangeText={value => {
                  if (strategyError) setStrategyError('');
                  setExtraSaved(false);
                  setExtraDraft(prev => acceptMoneyEdit(prev, value, currencyCode));
                }}
                onClear={() => {
                  if (strategyError) setStrategyError('');
                  setExtraSaved(false);
                  setExtraDraft('');
                }}
                onStep={dir => stepScenarioAmount(monthlyParsed, extraMonthlyPayment, dir * extraStepAmount, setExtraDraft)}
                onSubmitEditing={() => {
                  extraInputRef.current?.blur();
                  Keyboard.dismiss();
                }}
              />
              {monthlyParsed.valid && monthlyParsed.amount !== extraMonthlyPayment ? (
                canEdit && onExtra ? (
                  <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Save monthly plan"
                      disabled={extraBusy}
                      onPress={() => {
                        extraInputRef.current?.blur();
                        oneTimeInputRef.current?.blur();
                        Keyboard.dismiss();
                        void commitExtraPayment();
                      }}
                      style={{
                        flex: 1,
                        minHeight: 40,
                        borderRadius: 10,
                        backgroundColor: ctaBg,
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingHorizontal: 12,
                        opacity: extraBusy ? 0.65 : 1,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: ctaFg }}>
                        {extraBusy ? 'Saving…' : 'Save monthly plan'}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Reset to saved monthly amount"
                      disabled={extraBusy}
                      onPress={() => {
                        extraInputRef.current?.blur();
                        Keyboard.dismiss();
                        setStrategyError('');
                        setExtraSaved(false);
                        setExtraDraft(formatEditableMoney(extraMonthlyPayment, currencyCode));
                      }}
                      style={{
                        minHeight: 40,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: palette.border,
                        backgroundColor: palette.surface,
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingHorizontal: 14,
                        opacity: extraBusy ? 0.65 : 1,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: palette.text }}>Reset</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={[ui.small, { color: palette.muted }]}>
                    {`View-only estimate · Saved plan is ${formatCurrency(extraMonthlyPayment, currencySymbol)}/mo`}
                  </Text>
                )
              ) : null}
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border }} />
              <View style={{ gap: 6 }}>
                <ExtraAmountRow
                  label="One-time extra payment"
                  rawDraft={oneTimeDraft}
                  focused={oneTimeFocused}
                  editable={!extraBusy}
                  unitLabel="one time"
                  inputAccessibilityLabel="One-time extra payment amount"
                  minusAccessibilityLabel="Decrease one-time extra payment"
                  plusAccessibilityLabel="Increase one-time extra payment"
                  clearAccessibilityLabel="Clear one-time extra payment"
                  inputRef={oneTimeInputRef}
                  canDecrement={(oneTimeParsed.valid ? oneTimeParsed.amount : 0) > 0}
                  currencyCode={currencyCode}
                  currencySymbol={currencySymbol}
                  headerRight={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`One-time preview date, ${formatShortDate(oneTimeDate)}`}
                      hitSlop={6}
                      disabled={extraBusy}
                      onPress={() => {
                        extraInputRef.current?.blur();
                        oneTimeInputRef.current?.blur();
                        Keyboard.dismiss();
                        setShowOneTimeDatePicker(true);
                      }}
                      style={[
                        ui.row,
                        {
                          gap: 5,
                          paddingHorizontal: 9,
                          paddingVertical: 4,
                          borderRadius: 999,
                          backgroundColor: palette.raised,
                          borderWidth: 1,
                          borderColor: palette.cardBorder,
                          alignItems: 'center',
                        },
                      ]}
                    >
                      <AppIcon name="calendar" size={13} color={palette.accentInk} />
                      <Text numberOfLines={1} style={[ui.small, { color: palette.text, fontSize: 12, fontWeight: '600' }]}>
                        {formatShortDate(oneTimeDate)}
                      </Text>
                      <AppIcon name="chevronDown" size={12} color={palette.muted} />
                    </Pressable>
                  }
                  onFocus={() => setOneTimeFocused(true)}
                  onBlur={() => setOneTimeFocused(false)}
                  onChangeText={value => {
                    if (strategyError) setStrategyError('');
                    setOneTimeDraft(prev => acceptMoneyEdit(prev, value, currencyCode));
                  }}
                  onClear={() => {
                    if (strategyError) setStrategyError('');
                    setOneTimeDraft('');
                  }}
                  onStep={dir => stepScenarioAmount(oneTimeParsed, 0, dir * extraStepAmount, setOneTimeDraft)}
                  onSubmitEditing={() => {
                    oneTimeInputRef.current?.blur();
                    Keyboard.dismiss();
                  }}
                />
                <Text style={[ui.small, { color: palette.muted }]}>
                  {previewOneTimeAmount > 0
                    ? `Local preview only · modeled in ${oneTimeCycleInfo.cycleLabel} monthly cycle${oneTimeCycleInfo.period > 600 ? ' (beyond 600-mo limit)' : ''}`
                    : 'Local estimate only'}
                </Text>
              </View>
            </View>
            {!scenarioValid ? (
              <Text accessibilityRole="alert" style={[ui.small, { color: palette.neg }]}>
                {`Enter a valid amount of ${formatCurrency(0, currencySymbol)} or more.`}
              </Text>
            ) : strategyError ? (
              <Text accessibilityRole="alert" style={[ui.small, { color: palette.neg }]}>
                {strategyError}
              </Text>
            ) : null}
          </Card>
          {(() => {
            const hasMethodComparison = strategyComparison.snowball.monthsToPayoff !== null
              && strategyComparison.avalanche.monthsToPayoff !== null;
            const interestDiff = strategyComparison.avalancheInterestSavingsVsSnowball;
            const monthsDiff = strategyComparison.avalancheMonthsSavedVsSnowball;
            const collapsedBadge = hasMethodComparison && interestDiff !== null
              ? interestDiff > 0
                ? `Avalanche saves ${formatCurrency(interestDiff, currencySymbol)}`
                : interestDiff < 0
                  ? `Snowball saves ${formatCurrency(Math.abs(interestDiff), currencySymbol)}`
                  : 'Equal interest'
              : null;
            const comparisonTakeaway = hasMethodComparison
              ? interestDiff !== null && interestDiff > 0
                ? `Avalanche saves ${formatCurrency(interestDiff, currencySymbol)} interest${monthsDiff && monthsDiff > 0 ? ` and ${monthsDiff} mo` : ''} vs. Snowball.`
                : interestDiff !== null && interestDiff < 0
                  ? `Snowball saves ${formatCurrency(Math.abs(interestDiff), currencySymbol)} interest${monthsDiff && monthsDiff < 0 ? ` and ${Math.abs(monthsDiff)} mo` : ''} vs. Avalanche.`
                  : monthsDiff !== null && monthsDiff > 0
                    ? `Avalanche saves ${monthsDiff} mo vs. Snowball with equal interest.`
                    : monthsDiff !== null && monthsDiff < 0
                      ? `Snowball saves ${Math.abs(monthsDiff)} mo vs. Avalanche with equal interest.`
                      : 'Both methods project the same payoff date and total interest.'
              : 'Snowball pays smallest balances first for faster momentum. Avalanche targets highest APR first to minimize interest.';
            return (
              <Card style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, gap: comparisonExpanded ? 10 : 0, overflow: 'hidden' }}>
                {isInspire ? <InspireCornerArt kind="corner-wave" borderRadius={16} /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: comparisonExpanded }}
                  accessibilityLabel="Snowball vs. Avalanche comparison"
                  onPress={() => {
                    extraInputRef.current?.blur();
                    oneTimeInputRef.current?.blur();
                    Keyboard.dismiss();
                    setComparisonExpanded(open => !open);
                  }}
                  style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', minHeight: 28, gap: 8 }]}
                >
                  <Text style={[ui.heading, { fontSize: 15, flex: 1, minWidth: 0 }]}>Snowball vs. Avalanche</Text>
                  <View style={[ui.row, { alignItems: 'center', gap: 6, flexShrink: 0 }]}>
                    {!comparisonExpanded && collapsedBadge ? (
                      <Text numberOfLines={1} style={[ui.small, { color: interestDiff && interestDiff !== 0 ? palette.posInk : palette.muted, fontWeight: '700' }]}>
                        {collapsedBadge}
                      </Text>
                    ) : null}
                    <AppIcon name={comparisonExpanded ? 'chevronDown' : 'chevronRight'} size={16} color={palette.brand} />
                  </View>
                </Pressable>
                {comparisonExpanded ? (
                  <View style={{ gap: 8, paddingTop: 2 }}>
                    {hasMethodComparison ? (
                      <>
                        <View style={{ gap: 6 }}>
                          {([
                            { id: 'snowball', label: 'Snowball', data: strategyComparison.snowball },
                            { id: 'avalanche', label: 'Avalanche', data: strategyComparison.avalanche },
                          ] as const).map(item => (
                            <View key={item.id} style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 10 }]}>
                              <Text style={[ui.small, { color: strategy === item.id ? palette.text : palette.muted, fontWeight: strategy === item.id ? '700' : '600' }]}>
                                {item.label}
                              </Text>
                              <Text style={{ fontSize: 13, fontWeight: strategy === item.id ? '700' : '600', color: palette.text }}>
                                {`${item.data.monthsToPayoff} mo · ${formatCurrency(item.data.totalInterest, currencySymbol)} int.`}
                              </Text>
                            </View>
                          ))}
                        </View>
                        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border }} />
                      </>
                    ) : null}
                    <Text style={[ui.small, { color: hasMethodComparison && interestDiff !== null && interestDiff !== 0 ? palette.posInk : palette.muted, fontWeight: hasMethodComparison && interestDiff !== null && interestDiff !== 0 ? '700' : '500' }]}>
                      {comparisonTakeaway}
                    </Text>
                  </View>
                ) : null}
              </Card>
            );
          })()}
            {scenarioValid ? (() => {
              const {
                baseline,
                projected,
                firstPayment,
                nextPayment,
                oneTimePayment,
                monthsSaved,
                interestSaved,
                baselineExtraMonthlyPayment: savedExtra,
              } = scenarioComparison;
              const monthlyAmount = previewMonthlyAmount;
              const oneTimeAmount = previewOneTimeAmount;
              if (baseline.payoffOrder.length === 0) {
                const hasActiveMortgages = debts.some(d => d.category === 'Mortgage' && d.balance > 0)
                  && !debts.some(d => isActiveDebtItem(d) && d.balance > 0);
                const reason = hasActiveMortgages
                  ? 'Active balances are mortgages only. Switch to Mortgage strategy to view mortgage payments.'
                  : baseline.status === 'paidOff' && debts.length > 0
                    ? `All tracked Debt strategy accounts are already at ${formatCurrency(0, currencySymbol)}.`
                    : 'Add an active debt account with balance, APR, and minimum payment to project extra payments.';
                return (
                  <View style={{ backgroundColor: palette.raised, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: palette.border, gap: 4 }}>
                    <Text style={[ui.heading, { fontSize: 14 }]}>Projection unavailable</Text>
                    <Text style={[ui.small, { color: palette.muted }]}>{reason}</Text>
                  </View>
                );
              }

              const bothPaidOff = baseline.status === 'paidOff'
                && projected.status === 'paidOff'
                && baseline.monthsToPayoff !== null
                && projected.monthsToPayoff !== null;
              const previewOnlyPaidOff = baseline.status !== 'paidOff'
                && projected.status === 'paidOff'
                && projected.monthsToPayoff !== null;
              const isMatchesSavedPlan = monthlyAmount === savedExtra && oneTimeAmount === 0;
              const savedPlanLabel = `Saved plan (${formatCurrency(savedExtra, currencySymbol)}/mo)`;
              const scenarioPlanLabel = oneTimeAmount > 0 && monthlyAmount === savedExtra
                ? (monthlyAmount > 0
                  ? `Saved + ${formatCurrency(oneTimeAmount, currencySymbol)} (${oneTimeCycleInfo.cycleLabel})`
                  : `One time (${formatCurrency(oneTimeAmount, currencySymbol)} · ${oneTimeCycleInfo.cycleLabel})`)
                : oneTimeAmount > 0
                  ? `${formatCurrency(monthlyAmount, currencySymbol)}/mo + ${formatCurrency(oneTimeAmount, currencySymbol)} (${oneTimeCycleInfo.cycleLabel})`
                  : `New monthly (${formatCurrency(monthlyAmount, currencySymbol)} extra/mo)`;
              const lossColor = palette.neg;

              let comparisonSummary: ReactNode;
              if (isMatchesSavedPlan) {
                comparisonSummary = (
                  <View style={{ backgroundColor: palette.selection, borderRadius: 14, padding: 12, borderWidth: isInspire ? 1.5 : 1, borderColor: palette.cardBorder, gap: 4 }}>
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 10 }]}>
                      <Text style={[ui.small, { fontWeight: '700', color: palette.text }]}>{savedPlanLabel}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: palette.accentInk }}>
                        {baseline.status === 'paidOff' && baseline.monthsToPayoff !== null
                          ? `${homeDebtFreeEstimateDate(baseline.debtFreeDateLabel)} · ${baseline.monthsToPayoff} mo`
                          : baseline.debtFreeDateLabel}
                      </Text>
                    </View>
                    <Text style={[ui.small, { color: palette.muted }]}>
                      Adjust Monthly amount or enter a One-time amount to compare against your saved plan.
                    </Text>
                  </View>
                );
              } else if (bothPaidOff) {
                const baselineDateLabel = homeDebtFreeEstimateDate(baseline.debtFreeDateLabel);
                const projectedDateLabel = homeDebtFreeEstimateDate(projected.debtFreeDateLabel);
                const safeMonthsSaved = monthsSaved ?? 0;
                const safeInterestSaved = interestSaved ?? 0;
                const interestColor = safeInterestSaved > 0 ? palette.posInk : safeInterestSaved < 0 ? lossColor : palette.text;
                const timingColor = safeMonthsSaved > 0 ? palette.posInk : safeMonthsSaved < 0 ? lossColor : palette.text;
                const timingLabel = safeMonthsSaved > 0
                  ? `${safeMonthsSaved} ${safeMonthsSaved === 1 ? 'month' : 'months'} sooner`
                  : safeMonthsSaved < 0
                    ? `${Math.abs(safeMonthsSaved)} ${Math.abs(safeMonthsSaved) === 1 ? 'month' : 'months'} later`
                    : 'Same month';
                comparisonSummary = (
                  <View style={{ backgroundColor: palette.selection, borderRadius: 14, padding: 12, borderWidth: isInspire ? 1.5 : 1, borderColor: palette.cardBorder, gap: 8 }}>
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }]}>
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text style={[ui.small, { color: palette.muted }]}>Interest saved</Text>
                        <AmountText
                          style={{ fontSize: 20, fontWeight: '800', color: interestColor }}
                          value={formatCurrency(safeInterestSaved, currencySymbol)}
                        />
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <Text style={[ui.small, { color: palette.muted }]}>Payoff timing</Text>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: timingColor }}>
                          {timingLabel}
                        </Text>
                      </View>
                    </View>
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border }} />
                    <View style={{ gap: 4 }}>
                      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 10 }]}>
                        <Text style={[ui.small, { color: palette.muted, flex: 1, minWidth: 0 }]} numberOfLines={1}>{savedPlanLabel}</Text>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: palette.text }}>
                          {`${baselineDateLabel} · ${baseline.monthsToPayoff} mo`}
                        </Text>
                      </View>
                      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 10 }]}>
                        <Text style={[ui.small, { color: palette.muted, flex: 1, minWidth: 0 }]} numberOfLines={1}>{scenarioPlanLabel}</Text>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: timingColor }}>
                          {`${projectedDateLabel} · ${projected.monthsToPayoff} mo`}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              } else if (previewOnlyPaidOff) {
                comparisonSummary = (
                  <View style={{ backgroundColor: palette.selection, borderRadius: 14, padding: 12, borderWidth: isInspire ? 1.5 : 1, borderColor: palette.cardBorder, gap: 6 }}>
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 10 }]}>
                      <Text style={[ui.small, { color: palette.muted, flex: 1, minWidth: 0 }]} numberOfLines={1}>{savedPlanLabel}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: palette.muted }}>Unavailable</Text>
                    </View>
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 10 }]}>
                      <Text style={[ui.small, { color: palette.muted, flex: 1, minWidth: 0 }]} numberOfLines={1}>{scenarioPlanLabel}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: palette.accentInk }}>
                        {`${homeDebtFreeEstimateDate(projected.debtFreeDateLabel)} · ${projected.monthsToPayoff} mo`}
                      </Text>
                    </View>
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 10 }]}>
                      <Text style={[ui.small, { color: palette.muted }]}>Interest saved</Text>
                      <Text style={[ui.small, { color: palette.muted }]}>Unavailable (no baseline payoff)</Text>
                    </View>
                  </View>
                );
              } else {
                const unavailableDetail = projected.status === 'paymentShortfall'
                  ? 'Monthly commitment does not cover required minimum payments.'
                  : projected.status === 'notAmortizingUnderAssumptions'
                    ? 'Ongoing payments do not reduce balances enough to project a payoff date.'
                    : projected.status === 'horizonReached'
                      ? 'Payoff exceeds the 600-month projection limit.'
                      : 'Missing valid balance, APR, or minimum payment data.';
                comparisonSummary = (
                  <View style={{ backgroundColor: palette.raised, borderRadius: 14, padding: 12, borderWidth: isInspire ? 1.5 : 1, borderColor: palette.cardBorder, gap: 6 }}>
                    {baseline.status === 'paidOff' && baseline.monthsToPayoff !== null ? (
                      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 10 }]}>
                        <Text style={[ui.small, { color: palette.muted, flex: 1, minWidth: 0 }]} numberOfLines={1}>{savedPlanLabel}</Text>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: palette.text }}>
                          {`${homeDebtFreeEstimateDate(baseline.debtFreeDateLabel)} · ${baseline.monthsToPayoff} mo`}
                        </Text>
                      </View>
                    ) : null}
                    <View style={{ gap: 2 }}>
                      <Text style={[ui.heading, { fontSize: 14, color: lossColor }]}>{projected.debtFreeDateLabel}</Text>
                      <Text style={[ui.small, { color: palette.muted }]}>{unavailableDetail}</Text>
                    </View>
                  </View>
                );
              }

              const rows = [
                ...projected.payoffOrder.map(account => ({ account, item: firstPayment?.allocations.find(allocation => allocation.accountId === account.id) })),
                ...(firstPayment?.allocations ?? []).filter(item => !projected.payoffOrder.some(account => account.id === item.accountId)).map(item => ({
                  account: (projected.allProjections ?? []).find(account => account.id === item.accountId), item,
                })),
              ];
              const oneTimeSummarySuffix = oneTimeAmount > 0 && oneTimeCycleInfo.period > 2
                ? oneTimePayment
                  ? ` · ${oneTimePayment.monthLabel}: ${formatCurrency(oneTimePayment.totalPaid, currencySymbol)}`
                  : projected.status === 'paidOff' && (projected.monthsToPayoff ?? 0) < oneTimeCycleInfo.period
                    ? ` · Paid off before ${oneTimeCycleInfo.cycleLabel}`
                    : ''
                : '';
              return (
                <View style={{ gap: 8 }}>
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingHorizontal: 2 }]}>
                      <Text style={ui.heading}>Payoff order</Text>
                      <View style={{ backgroundColor: palette.selection, borderWidth: isInspire ? 1.5 : 1, borderColor: palette.brand, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}><Text style={[ui.small, { color: palette.accentInk, fontWeight: '700' }]}>Estimated</Text></View>
                    </View>
                  <Card style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 4, borderRadius: 16, overflow: 'hidden' }}>
                    {isInspire ? <InspireCornerArt kind="corner-ridge" borderRadius={16} /> : null}
                    <Pressable accessibilityRole="button" accessibilityLabel="Plan comparison" accessibilityState={{ expanded: scenarioComparisonExpanded }} onPress={() => setScenarioComparisonExpanded(open => !open)} style={[ui.row, { minHeight: 44, justifyContent: 'space-between', alignItems: 'center' }]}>
                      <Text style={[ui.small, { color: palette.text, fontWeight: '700' }]}>Plan comparison</Text>
                      <AppIcon name={scenarioComparisonExpanded ? 'chevronDown' : 'chevronRight'} size={16} color={palette.muted} />
                    </Pressable>
                    {scenarioComparisonExpanded ? comparisonSummary : null}
                    {rows.length ? rows.map(({ account, item }, idx) => (
                      <ScenarioAllocationRow
                        key={item?.accountId ?? account!.id}
                        account={account}
                        item={item}
                        category={debts.find(d => d.id === (item?.accountId ?? account?.id))?.category}
                        index={idx}
                        currencySymbol={currencySymbol}
                        onBeforeToggle={() => { extraInputRef.current?.blur(); oneTimeInputRef.current?.blur(); Keyboard.dismiss(); }}
                      />
                    )) : <Text style={[ui.small, { color: palette.muted }]}>Projection unavailable.</Text>}
                    {firstPayment ? <Text style={[ui.small, { color: palette.muted, paddingTop: 8 }]}>{`First payment: ${formatCurrency(firstPayment.totalPaid, currencySymbol)}${firstPayment.unusedBudget > 0 ? ` · ${formatCurrency(firstPayment.unusedBudget, currencySymbol)} unapplied` : ''}${nextPayment ? ` · Month 2: ${formatCurrency(nextPayment.totalPaid, currencySymbol)}` : ''}${oneTimeSummarySuffix}`}</Text> : null}
                  </Card>
                </View>
              );
            })() : <Card><Text style={ui.small}>Enter a valid amount to view the payoff order.</Text></Card>}
        </> : <>
          {mortgageDebts.filter(item => item.balance > 0).map(item => {
            const escrow = mortgageEscrowByDebtId[item.id];
            const projection = mortgageProjectionById.get(item.id);
            const draft = mortgageExtraDrafts[item.id] ?? formatEditableMoney(mortgageExtraPaymentByDebtId[item.id] ?? 0, currencyCode);
            const isMortgageFocused = focusedMortgageId === item.id;
            return <Card key={item.id} style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8, borderRadius: 16, overflow: 'hidden' }}>
              {isInspire ? <InspireCornerArt kind="corner-ridge" borderRadius={16} /> : null}
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                <Text style={ui.heading}>{item.name}</Text>
                {extraBusy && isMortgageFocused ? <Text style={[ui.small, { color: palette.brand, fontWeight: '600' }]}>Saving…</Text> : savedMortgageId === item.id ? <Text style={[ui.small, { color: palette.brand, fontWeight: '600' }]}>Saved</Text> : null}
              </View>
              <Text style={ui.small}>{escrow === undefined ? 'No escrow amount is entered. Add the known monthly escrow in this account’s editor to show a principal and interest projection.' : `Known escrow excluded: ${formatCurrency(escrow, currencySymbol)} per month.`}</Text>
              <Text style={ui.small}>Independent extra payment per month</Text>
              <View style={[ui.row, { gap: 8, paddingHorizontal: 12, minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: isMortgageFocused ? palette.brand : palette.border, backgroundColor: isLight ? palette.canvas : palette.raised, opacity: canEdit ? 1 : 0.7 }]}>
                <Text style={[ui.heading, { color: palette.muted }]}>{currencySymbol}</Text>
                <TextInput
                  ref={node => { mortgageInputRefs.current[item.id] = node; }}
                  editable={canEdit}
                  accessibilityLabel={`Extra monthly payment for ${item.name}`}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  underlineColorAndroid="transparent"
                  value={draft}
                  onFocus={() => {
                    setFocusedMortgageId(item.id);
                    setSavedMortgageId(null);
                  }}
                  onChangeText={value => {
                    if (!canEdit) return;
                    if (strategyError) setStrategyError('');
                    setMortgageExtraDrafts(current => ({ ...current, [item.id]: acceptMoneyEdit(current[item.id] ?? formatEditableMoney(mortgageExtraPaymentByDebtId[item.id] ?? 0, currencyCode), value, currencyCode) }));
                  }}
                  onSubmitEditing={() => {
                    mortgageInputRefs.current[item.id]?.blur();
                    Keyboard.dismiss();
                  }}
                  onBlur={() => {
                    setFocusedMortgageId(current => (current === item.id ? null : current));
                    void commitMortgageExtra(item.id);
                  }}
                  style={{ flex: 1, minHeight: 42, paddingVertical: 4, color: palette.text, fontSize: 18, fontWeight: '700', borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 }}
                />
                <Text style={ui.small}>/ month</Text>
              </View>
              {!!strategyError && <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78' }]}>{strategyError}</Text>}
              {escrow !== undefined && escrow <= item.minimumPayment && item.minimumPayment - escrow + (mortgageExtraPaymentByDebtId[item.id] ?? 0) <= 0 ? <Text style={ui.small}>Enter a positive known principal and interest payment or extra amount to project this account.</Text> : null}
              {projection ? <ProjectionRow account={projection} category={item.category} index={0} showDivider={false} currencySymbol={currencySymbol} onBeforeToggle={() => { mortgageInputRefs.current[item.id]?.blur(); Keyboard.dismiss(); }} /> : null}
            </Card>;
          })}
          {!mortgageDebts.some(item => item.balance > 0) ? <Card><Text style={ui.small}>No active mortgage account has been entered.</Text></Card> : null}
        </>}
      </Pressable>
      ) : null)}
    />
    {editor}
    <AdaptiveModal visible={!!selected} transparent animationType="slide" onRequestClose={backToAccounts}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close account details" onPress={backToAccounts} style={{ flex: 1 }} />
        {selected && <View accessibilityViewIsModal style={{ height: '88%', backgroundColor: palette.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' }}>
          <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: palette.border, alignSelf: 'center', marginTop: 10, marginBottom: 4 }} />
          <View style={[ui.row, { justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }]}>
            <View style={[ui.row, { flex: 1, minWidth: 0, gap: 10 }]}>
              <View style={[ui.iconCircle, { backgroundColor: appearanceColor(selected.category === 'Mortgage' ? '#60A5FA' : selected.category === 'Auto loan' ? '#60A5FA' : '#76DCB9', isLight) + '18', borderWidth: 0 }]}><AppIcon name={selected.category === 'Mortgage' ? 'homeLoan' : selected.category === 'Auto loan' ? 'auto' : 'creditCard'} color={appearanceColor(selected.category === 'Mortgage' ? '#60A5FA' : selected.category === 'Auto loan' ? '#60A5FA' : '#76DCB9', isLight)} size={20} /></View>
              <View style={{ flex: 1, minWidth: 0 }}><Text accessibilityRole="header" style={ui.heading}>{selected.name}</Text><Text style={ui.small}>{selected.category}</Text></View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close account details" onPress={backToAccounts} style={ui.button}><AppIcon name="close" size={20} color={palette.muted} /></Pressable>
          </View>
          <ScrollView
            contentContainerStyle={[
              ui.screen,
              {
                paddingTop: 8,
                paddingBottom: Math.max(insets.bottom, 20) + (section === 'Transactions' && canEdit && onAddTransaction ? 88 : 16),
              },
            ]}
            keyboardShouldPersistTaps="handled"
            {...detailScrollHandlers}
          >
        <Segments items={detailSections} selected={section} onSelect={value => { setSection(value); setReconciling(false); }} hideBaseline />
        {section === 'Overview' && <>
          <View style={{ position: 'relative', backgroundColor: palette.hero, borderRadius: 14, padding: 16, gap: 8, overflow: 'hidden' }}>
            <HeroGradient borderRadius={14} />
            <HeroOrbit />
            <Text style={{ color: palette.heroSecondary, fontSize: 12, fontWeight: '700' }}>CURRENT BALANCE</Text>
            <View style={[ui.row, { gap: 10, alignItems: 'center', flexWrap: 'wrap' }]}>
              <AmountText style={{ color: palette.onHero, fontSize: 32, fontWeight: '700' }} value={formatCurrency(selected.balance, currencySymbol)} />
              {(() => {
                const detailReduction = getAccountReductionDisplay(selected, isArchivedDebt(selected), palette);
                if (!detailReduction.badgeText) return null;
                return (
                  <View style={{
                    paddingHorizontal: 9,
                    paddingVertical: 3,
                    borderRadius: 999,
                    backgroundColor: isLight ? 'rgba(255,255,255,0.88)' : 'rgba(9,13,20,0.72)',
                  }}>
                    <Text style={{ color: detailReduction.color, fontSize: 13, fontWeight: '800' }}>
                      {detailReduction.badgeText}
                    </Text>
                  </View>
                );
              })()}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="About account balance comparison" onPress={() => showInformation('Balance comparison', 'The adjusted reference is the higher of the current and entered original balance. Increases are excluded from this reduction measure. The comparison is unavailable if the entered original balance is missing. This snapshot may include corrections or credits; it is not payment history.')} style={[ui.row, { minHeight: 44 }]}>
              <Text style={[ui.small, { color: palette.heroSecondary }]}>{selected.originalBalance == null ? 'Reference unavailable' : 'Adjusted reference'}</Text>
              <AppIcon name="info" size={14} color={palette.onHero} />
            </Pressable>
          </View>
          <View style={[ui.row, { gap: 10 }]}><View style={{ flex: 1, backgroundColor: palette.raised, borderRadius: 12, padding: 14 }}><Text style={ui.small}>APR</Text><Text style={[ui.heading, { color: selected.apr < 15 ? palette.posInk : palette.neg }]}>{selected.apr}%</Text></View><View style={{ flex: 1, backgroundColor: palette.raised, borderRadius: 12, padding: 14 }}><Text style={ui.small}>Minimum / month</Text><Text style={ui.heading}>{formatCurrency(selected.minimumPayment, currencySymbol)}</Text></View></View>
          <Card style={{ paddingVertical: 4, paddingHorizontal: 16, borderRadius: 14 }}>
            <Term label="Due day" value={selected.dueDay ? formatOrdinal(selected.dueDay) : 'Not set'} />
            <Term label="Estimated payoff" value={projection?.projectedPayoffLabel ?? 'No active projection'} />
            {selected.category === 'Credit card' ? (
              <>
                <Term label="Credit limit" value={selected.creditLimit === null ? 'Not set' : formatCurrency(selected.creditLimit, currencySymbol)} />
                <Term label="Annual fee" value={selected.annualFeeAmount != null ? formatCurrency(selected.annualFeeAmount, currencySymbol) : 'Not set'} />
              </>
            ) : null}
            {selected.category === 'Mortgage' ? (
              <Term label="Monthly escrow" value={selectedEscrow !== undefined ? formatCurrency(selectedEscrow, currencySymbol) : 'Not set'} />
            ) : null}
          </Card>
          {(selected.category === 'Mortgage' || selected.category === 'Auto loan') && selected.balance > 0 ? (() => {
            const overviewEscrow = selected.category === 'Mortgage' ? selectedEscrow : undefined;
            if (selected.minimumPayment > 0 && canSuggestLoanPaymentSplit(selected, overviewEscrow)) {
              let autoEst: ReturnType<typeof resolveAutoLoanSplitSuggestion> | null = null;
              let nextDueDate: DateOnly | null = null;
              let nextSplit;
              if (selected.category === 'Auto loan') {
                const lastPaymentDate = findPreviousLoanPaymentDate({
                  debtId: selected.id,
                  transactions,
                  onOrBeforeDate: projectionDay,
                  linkedBillIds: selectedLinkedBillIds,
                });
                nextDueDate = resolveNextAutoDueDate({
                  dueDay: selected.dueDay,
                  today: projectionDay,
                  lastPaymentDate,
                });
                autoEst = resolveAutoLoanSplitSuggestion({
                  debt: selected,
                  paymentAmount: selected.minimumPayment,
                  paymentDate: nextDueDate ?? projectionDay,
                  transactions,
                  currencyCode,
                  preferredMethod: nextDueDate === null ? 'monthly' : undefined,
                  linkedBillIds: selectedLinkedBillIds,
                });
                nextSplit = autoEst.suggestion;
              } else {
                nextSplit = suggestLoanPaymentSplit({
                  balance: selected.balance,
                  aprPercent: selected.apr,
                  paymentAmount: selected.minimumPayment,
                  escrowAmount: overviewEscrow,
                  currencyCode,
                });
              }
              const estAfter = projectedLoanBalanceAfterPrincipal(selected.balance, nextSplit.principal, currencyCode);
              return (
                <Card style={{ paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14, gap: 8 }}>
                  <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 8 }]}>
                    <Text style={ui.heading}>Next payment estimate</Text>
                    {selected.category === 'Mortgage' && selectedEscrow !== undefined ? (
                      <Text style={[ui.small, { color: palette.muted }]}>{`P&I ${formatCurrency(Math.max(0, roundToCurrencyScale(selected.minimumPayment - nextSplit.escrow, currencyCode)), currencySymbol)}`}</Text>
                    ) : autoEst ? (
                      <Text style={[ui.small, { color: palette.muted }]}>{`${formatCurrency(autoEst.dailyInterestCost, currencySymbol)}/day`}</Text>
                    ) : null}
                  </View>
                  {autoEst ? (
                    <Text style={[ui.small, { color: palette.muted }]}>
                      {autoEst.method === 'daily_simple' && nextDueDate
                        ? `Daily · ${autoEst.daysElapsed}d to ${formatShortDate(nextDueDate)}`
                        : !autoEst.lastPaymentDate
                          ? 'Monthly est. · no prior payment yet'
                          : 'Monthly est. (set due day for daily projection)'}
                    </Text>
                  ) : null}
                  <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 8 }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[ui.small, { color: palette.muted }]}>Principal</Text>
                      <AmountText value={formatCurrency(nextSplit.principal, currencySymbol)} style={[ui.heading, { fontSize: 16, color: palette.posInk }]} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[ui.small, { color: palette.muted }]}>Interest</Text>
                      <AmountText value={formatCurrency(nextSplit.interest, currencySymbol)} style={[ui.heading, { fontSize: 16, color: palette.neg }]} />
                    </View>
                    {selected.category === 'Mortgage' ? (
                      <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}>
                        <Text style={[ui.small, { color: palette.muted }]}>Escrow</Text>
                        <AmountText value={formatCurrency(nextSplit.escrow, currencySymbol)} style={[ui.heading, { fontSize: 16, color: palette.text, textAlign: 'right' }]} />
                      </View>
                    ) : null}
                  </View>
                  <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', paddingTop: 4, borderTopWidth: 1, borderTopColor: palette.border }]}>
                    <Text style={[ui.small, { color: palette.muted }]}>Est. balance after</Text>
                    <AmountText value={formatCurrency(estAfter, currencySymbol)} style={[ui.small, { fontWeight: '700', color: palette.text }]} />
                  </View>
                </Card>
              );
            }
            if (selected.category === 'Mortgage' && selectedEscrow === undefined) {
              return (
                <Card style={{ paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14, gap: 8 }}>
                  <Text style={ui.heading}>Next payment estimate</Text>
                  <Text style={[ui.small, { color: palette.muted }]}>Add monthly escrow in Detail to estimate principal & interest.</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSection('Detail')}
                    style={[ui.button, { alignSelf: 'flex-start' }]}
                  >
                    <Text style={[ui.buttonText, { color: palette.brand }]}>Set escrow</Text>
                  </Pressable>
                </Card>
              );
            }
            return null;
          })() : null}
          {projection && projection.monthlySchedule.length > 0 ? (
            <Card style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: timelineExpanded }}
                onPress={() => setTimelineExpanded(current => !current)}
                style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}
              >
                <View style={{ gap: 2 }}>
                  <Text style={ui.heading}>Payoff timeline</Text>
                  <Text style={ui.small}>{`${projection.monthlySchedule.length} monthly ${projection.monthlySchedule.length === 1 ? 'step' : 'steps'} · est. ${formatCurrency(projection.monthlySchedule.reduce((sum, row) => sum + row.interest, 0), currencySymbol)} interest`}</Text>
                </View>
                <AppIcon name={timelineExpanded ? 'chevronDown' : 'chevronRight'} size={16} color={palette.brand} />
              </Pressable>
              {timelineExpanded ? (
                <View style={{ backgroundColor: palette.raised, borderRadius: 12, padding: 10 }}>
                  <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
                    <View style={[ui.row, { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border }]}>
                      {['Month', 'Payment', 'Interest', 'Balance'].map((label, column) => (
                        <Text key={label} style={[ui.small, { flex: 1, fontWeight: '700', textAlign: column ? 'right' : 'left' }]}>{label}</Text>
                      ))}
                    </View>
                    {projection.monthlySchedule.map((row, rowIndex) => (
                      <View key={`${selected.id}-tl-${rowIndex}`} style={[ui.row, { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border }]}>
                        <Text style={[ui.text, { flex: 1, fontSize: 13 }]}>{row.month}</Text>
                        <Text style={[ui.text, { flex: 1, fontSize: 13, textAlign: 'right' }]}>{formatCurrency(row.payment, currencySymbol)}</Text>
                        <Text style={[ui.text, { flex: 1, fontSize: 13, textAlign: 'right' }]}>{formatCurrency(row.interest, currencySymbol)}</Text>
                        <Text style={[ui.text, { flex: 1, fontSize: 13, textAlign: 'right' }]}>{formatCurrency(row.balance, currencySymbol)}</Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </Card>
          ) : null}
          <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }]}>
            <Text style={ui.heading}>Balance history</Text>
            <InfoButton label="Balance history" detail="Statement records show recorded balance snapshots over time." />
          </View>
          {reconciliationAnchors.some(anchor => anchor.accountId === selected.id) ? (
            <BalanceSparkline selected={selected} anchors={reconciliationAnchors} currencySymbol={currencySymbol} />
          ) : (
            <View style={{ padding: 24, borderWidth: 1, borderStyle: 'dashed', borderColor: palette.border, borderRadius: 14, alignItems: 'center', gap: 7 }}>
              <AppIcon name="progress" size={24} color={palette.muted} />
              <Text style={ui.heading}>No statement history</Text>
              <Text style={ui.small}>Add a statement to begin your history.</Text>
            </View>
          )}
          {canEdit && onMarkPaid && selected.balance === 0 && !isArchivedDebt(selected) ? (
            <View style={{ gap: 8 }}>
              {!!markPaidError && <Text accessibilityRole="alert" style={[ui.small, { color: appearanceColor('#F08B78', isLight) }]}>{markPaidError}</Text>}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Mark ${selected.name} as paid and archive it`}
                accessibilityState={{ disabled: markPaidBusy }}
                disabled={markPaidBusy}
                onPress={() => void markSelectedAsPaid()}
                style={{ minHeight: 52, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.raised, justifyContent: 'center', alignItems: 'center', opacity: markPaidBusy ? 0.65 : 1 }}
              >
                <Text style={[ui.value, { color: palette.text, fontWeight: '800' }]}>{markPaidBusy ? 'Marking as Paid…' : 'Mark as Paid'}</Text>
                <Text style={[ui.small, { textAlign: 'center' }]}>Moves this $0 account to Paid Off. Its history stays available.</Text>
              </Pressable>
            </View>
          ) : null}
        </>}
        {section === 'Transactions' && (() => {
          const currentMonthStr = currentHouseholdMonth(householdTimeZone);
          const prevMonthStr = getPreviousMonthString(currentMonthStr);

          const periodTx = accountTransactions.filter(tx => {
            if (txPeriod === 'Current month') return tx.date.slice(0, 7) === currentMonthStr;
            if (txPeriod === 'Previous month') return tx.date.slice(0, 7) === prevMonthStr;
            return true; // Lifetime
          });

          let pPayments = 0;
          let pInterestFees = 0;
          let pAdjustments = 0;
          let pNetChange = 0;

          for (const tx of periodTx) {
            const dir = classifyCategoryDirection(tx.category);
            const amt = moneyToMajor(tx.amount);
            if (tx.category === 'payment') {
              pPayments += amt;
            }
            if (['interest', 'fee', 'annual_fee'].includes(tx.category)) {
              pInterestFees += amt;
            }
            if (['interest_adjustment', 'balance_adjustment', 'credit_adjustment'].includes(tx.category)) {
              pAdjustments += amt;
            }
            if (dir === 'increase_debt') {
              pNetChange += amt;
            } else if (dir === 'decrease_debt') {
              pNetChange -= amt;
            }
          }

          return (
            <>
              <SelectDropdown label="Transaction period" value={txPeriod} options={txPeriodOptions} onSelect={setTxPeriod} sheetTitle="Choose transaction period" />

              <View style={[ui.row, { gap: 8, marginVertical: 4 }]}>
                <View style={[ui.card, { flex: 1, padding: 12, backgroundColor: palette.raised, borderWidth: 1, borderColor: palette.border, borderRadius: 12 }]}>
                  <View style={[ui.row, { gap: 5 }]}>
                    <AppIcon name="trendDown" size={14} color={appearanceColor('#76DCB9', isLight)} />
                    <Text numberOfLines={1} style={ui.small}>Payments</Text>
                  </View>
                  <Text style={[ui.heading, { fontSize: 16, color: palette.text }]}>{formatCurrency(pPayments, currencySymbol)}</Text>
                </View>
                <View style={[ui.card, { flex: 1, padding: 12, backgroundColor: palette.raised, borderWidth: 1, borderColor: palette.border, borderRadius: 12 }]}>
                  <View style={[ui.row, { gap: 5 }]}>
                    <AppIcon name="brandRise" size={14} color={appearanceColor('#F08B78', isLight)} />
                    <Text numberOfLines={1} style={ui.small}>Interest & Fees</Text>
                  </View>
                  <Text style={[ui.heading, { fontSize: 16, color: palette.text }]}>{formatCurrency(pInterestFees, currencySymbol)}</Text>
                </View>
              </View>

              <View style={[ui.row, { gap: 8, marginBottom: 8 }]}>
                <View style={[ui.card, { flex: 1, padding: 12, backgroundColor: palette.raised, borderWidth: 1, borderColor: palette.border, borderRadius: 12 }]}>
                  <View style={[ui.row, { gap: 5 }]}>
                    <AppIcon name="sort" size={14} color={palette.muted} />
                    <Text numberOfLines={1} style={ui.small}>Adjustments</Text>
                  </View>
                  <Text style={[ui.heading, { fontSize: 16, color: palette.text }]}>{formatCurrency(pAdjustments, currencySymbol)}</Text>
                </View>
                <View style={[ui.card, { flex: 1, padding: 12, backgroundColor: palette.raised, borderWidth: 1, borderColor: palette.border, borderRadius: 12 }]}>
                  <View style={[ui.row, { gap: 5 }]}>
                    <AppIcon name="trendDown" size={14} color={pNetChange < 0 ? appearanceColor('#76DCB9', isLight) : pNetChange > 0 ? appearanceColor('#F08B78', isLight) : palette.muted} />
                    <Text numberOfLines={1} style={ui.small}>Net balance</Text>
                  </View>
                  <Text style={[ui.heading, { fontSize: 16, color: pNetChange < 0 ? appearanceColor('#76DCB9', isLight) : pNetChange > 0 ? appearanceColor('#F08B78', isLight) : palette.text }]}>
                    {pNetChange < 0 ? `-${formatCurrency(Math.abs(pNetChange), currencySymbol)}` : pNetChange > 0 ? `+${formatCurrency(pNetChange, currencySymbol)}` : formatCurrency(0, currencySymbol)}
                  </Text>
                </View>
              </View>

              <Card>
                <Text style={ui.heading}>Account activity ({periodTx.length})</Text>
                {periodTx.length === 0 ? (
                  <Text style={ui.text}>
                    {canEdit && onAddTransaction
                      ? 'No transactions for this account in the selected period. Tap + to add one.'
                      : 'No transactions for this account in the selected period.'}
                  </Text>
                ) : (
                  periodTx.map(tx => {
                    const direction = classifyCategoryDirection(tx.category);
                    const amount = moneyToMajor(tx.amount);
                    const signed = direction === 'decrease_debt' ? `\u2212${formatCurrency(amount, currencySymbol)}` : `+${formatCurrency(amount, currencySymbol)}`;
                    const isPaymentLike = direction === 'decrease_debt' && (!tx.payee || /^Payment\b/i.test(tx.payee) || tx.category === 'payment');
                    const isBalanceAdj = tx.category === 'credit_adjustment' || tx.category === 'balance_adjustment' || /^Reconciliation credit adjustment$/i.test(tx.payee || '');
                    const displayPayee = isPaymentLike ? 'Payment' : isBalanceAdj ? 'Balance Adjustment' : tx.payee;
                    const displayCategory = (tx.category === 'credit_adjustment' || tx.category === 'balance_adjustment')
                      ? 'Updated'
                      : tx.category === 'interest_adjustment'
                        ? 'Interest Adjusted'
                        : tx.category.replace(/_/g, ' ');
                    const rowContent = (
                      <>
                        <View style={{ flex: 1 }}>
                          <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                            <Text style={[ui.heading, { fontSize: 16 }]}>{displayPayee}</Text>
                            {tx.isPending ? (
                              <View style={[ui.badge, { backgroundColor: '#38321E', borderColor: '#F2C94C', borderWidth: 1, paddingVertical: 2, paddingHorizontal: 8 }]}>
                                <Text style={[ui.badgeText, { color: '#F2C94C', fontSize: 12 }]}>Pending</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={ui.small}>{`${tx.date} \u00b7 ${displayCategory}`}</Text>
                        </View>
                        <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                          <Text style={[ui.value, { color: direction === 'decrease_debt' ? appearanceColor('#86E3B8', isLight) : appearanceColor('#F08B78', isLight) }]}>{signed}</Text>
                          {onSelectTransaction ? <AppIcon name="chevronRight" size={16} color={palette.muted} /> : null}
                        </View>
                      </>
                    );
                    if (onSelectTransaction) {
                      return (
                        <Pressable
                          key={tx.id}
                          accessibilityRole="button"
                          accessibilityLabel={`${displayPayee}, ${tx.date}, ${signed}`}
                          onPress={() => {
                            backToAccounts();
                            onSelectTransaction(tx);
                          }}
                          style={[ui.divider, ui.row, { justifyContent: 'space-between', minHeight: 44 }]}
                        >
                          {rowContent}
                        </Pressable>
                      );
                    }
                    return (
                      <View key={tx.id} style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
                        {rowContent}
                      </View>
                    );
                  })
                )}
              </Card>
            </>
          );
        })()}
        {section === 'Detail' && (() => {
          const detailRowStyle = {
            minHeight: 48,
            paddingVertical: 7,
            flexDirection: 'row' as const,
            alignItems: 'center' as const,
            justifyContent: 'space-between' as const,
            gap: 12,
          };
          const detailRowBorderStyle = { borderBottomWidth: 1, borderBottomColor: palette.border };
          const detailInlineInputStyle = {
            minHeight: 38,
            paddingVertical: 5,
            paddingHorizontal: 0,
            textAlign: 'right' as const,
            color: palette.text,
            fontSize: 15,
            fontWeight: '600' as const,
          };
          const detailPillStyle = {
            backgroundColor: isLight ? palette.canvas : palette.raised,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: palette.border,
            minHeight: 36,
            minWidth: 116,
            maxWidth: '56%' as const,
            paddingHorizontal: 10,
            flexDirection: 'row' as const,
            alignItems: 'center' as const,
            justifyContent: 'flex-end' as const,
            gap: 6,
          };
          const detailMoneyInputStyle = [detailInlineInputStyle, { width: 96, minWidth: 0, flexGrow: 0, flexShrink: 1 }];
          const parsedDetailDueDay = detailDraft.dueDay.trim() ? Number(detailDraft.dueDay.trim()) : null;
          const showCreditCardFields = detailDraft.category === 'Credit card';

          return <>
          {!canEdit ? (
            <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.tint, marginBottom: 10 }}>
              <Text style={[ui.small, { color: palette.text, fontWeight: '600' }]}>View-only access · Account terms and balances cannot be edited by Viewers.</Text>
            </View>
          ) : null}
          <Card style={{ paddingVertical: 6, paddingHorizontal: 16, borderRadius: 16, gap: 0 }}>
            <View style={[ui.row, detailRowBorderStyle, { justifyContent: 'space-between', alignItems: 'center', minHeight: 44 }]}>
              <Text style={ui.heading}>Account terms</Text>
              {canEdit && detailSaving ? (
                <Text style={[ui.small, { color: palette.brand, fontWeight: '600' }]}>Saving…</Text>
              ) : canEdit && detailSaved ? (
                <Text style={[ui.small, { color: palette.brand, fontWeight: '600' }]}>Saved</Text>
              ) : canEdit && detailDirty ? (
                <Text style={[ui.small, { color: palette.brand, fontWeight: '600' }]}>Unsaved changes</Text>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Account type: ${detailDraft.category}`}
              disabled={!canEdit}
              onPress={() => {
                if (!canEdit) return;
                Keyboard.dismiss();
                setShowDetailCategoryPicker(true);
              }}
              style={[detailRowStyle, detailRowBorderStyle]}
            >
              <Text style={[ui.text, { color: palette.muted }]}>Account type *</Text>
              <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                <Text style={[ui.text, { color: palette.text, fontWeight: '600' }]}>{detailDraft.category}</Text>
                {canEdit ? <AppIcon name="chevronDown" size={16} color={palette.brand} /> : null}
              </View>
            </Pressable>

            <View style={[detailRowStyle, detailRowBorderStyle]}>
              <Text style={[ui.text, { color: palette.muted }]}>Account name *</Text>
              <View style={[detailPillStyle, { width: '56%', maxWidth: '56%' }]}>
                <TextInput
                  editable={canEdit}
                  accessibilityLabel="Account name"
                  style={[detailInlineInputStyle, { flex: 1, minWidth: 0 }]}
                  value={detailDraft.name}
                  onChangeText={value => { if (canEdit) updateDetailDraft(prev => ({ ...prev, name: value })); }}
                  placeholder="Account name"
                  placeholderTextColor={palette.muted}
                />
              </View>
            </View>

            <View style={[detailRowStyle, detailRowBorderStyle]}>
              <Text style={[ui.text, { color: palette.muted }]}>Current balance *</Text>
              <View style={detailPillStyle}>
                <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                <TextInput
                  editable={canEdit}
                  accessibilityLabel="Current balance"
                  style={detailMoneyInputStyle}
                  keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                  value={formatDetailMoneyDisplay(detailDraft.balance, currencyCode, detailFocusedField === 'balance')}
                  onFocus={() => setDetailFocusedField('balance')}
                  onBlur={() => setDetailFocusedField(current => current === 'balance' ? null : current)}
                  onChangeText={value => { if (canEdit) updateDetailDraft(prev => ({ ...prev, balance: acceptMoneyEdit(prev.balance, value, currencyCode, true) })); }}
                  placeholder={formatEditableMoney(0, currencyCode)}
                  placeholderTextColor={palette.muted}
                />
              </View>
            </View>

            <View style={[detailRowStyle, detailRowBorderStyle]}>
              <Text style={[ui.text, { color: palette.muted }]}>Original balance</Text>
              <View style={detailPillStyle}>
                <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                <TextInput
                  editable={canEdit}
                  accessibilityLabel="Original balance"
                  style={detailMoneyInputStyle}
                  keyboardType="decimal-pad"
                  value={formatDetailMoneyDisplay(detailDraft.originalBalance, currencyCode, detailFocusedField === 'originalBalance')}
                  onFocus={() => setDetailFocusedField('originalBalance')}
                  onBlur={() => setDetailFocusedField(current => current === 'originalBalance' ? null : current)}
                  onChangeText={value => { if (canEdit) updateDetailDraft(prev => ({ ...prev, originalBalance: acceptMoneyEdit(prev.originalBalance, value, currencyCode) })); }}
                  placeholder="Optional"
                  placeholderTextColor={palette.muted}
                />
              </View>
            </View>

            <View style={[detailRowStyle, detailRowBorderStyle]}>
              <Text style={[ui.text, { color: palette.muted }]}>APR *</Text>
              <View style={detailPillStyle}>
                <TextInput
                  editable={canEdit}
                  accessibilityLabel="APR percentage"
                  style={[detailInlineInputStyle, { width: 74, minWidth: 0, flexGrow: 0, flexShrink: 1 }]}
                  keyboardType="decimal-pad"
                  value={detailDraft.apr}
                  onFocus={() => setDetailFocusedField('apr')}
                  onBlur={() => setDetailFocusedField(current => current === 'apr' ? null : current)}
                  onChangeText={value => { if (canEdit) updateDetailDraft(prev => ({ ...prev, apr: acceptAprEdit(prev.apr, value) })); }}
                  placeholder="0.00"
                  placeholderTextColor={palette.muted}
                />
                <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>%</Text>
              </View>
            </View>

            <View style={[{ paddingVertical: 10, gap: 8 }, detailRowBorderStyle]}>
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                <Text style={[ui.text, { color: palette.muted }]}>Minimum payment *</Text>
                <View style={[ui.row, { gap: 4, padding: 3, borderRadius: 10, backgroundColor: isLight ? palette.canvas : palette.raised, borderWidth: 1, borderColor: palette.border, opacity: canEdit ? 1 : 0.7 }]}>
                  {(['auto', 'manual'] as const).map(mode => {
                    const active = detailDraft.minimumMode === mode;
                    return (
                      <Pressable
                        key={mode}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`Minimum payment ${mode}`}
                        disabled={!canEdit}
                        onPress={() => {
                          if (!canEdit) return;
                          updateDetailDraft(prev => ({
                            ...prev,
                            minimumMode: mode,
                            minimumPayment: mode === 'manual' && !prev.minimumPayment.trim() && detailAutoEstimatedMin > 0
                              ? formatEditableMoney(detailAutoEstimatedMin, currencyCode)
                              : prev.minimumPayment,
                          }));
                        }}
                        style={{
                          minHeight: 30,
                          paddingHorizontal: 10,
                          borderRadius: 7,
                          justifyContent: 'center',
                          backgroundColor: active ? palette.tint : 'transparent',
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: active ? palette.brand : palette.muted }}>
                          {mode === 'auto' ? 'Auto' : 'Manual'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              {detailDraft.minimumMode === 'auto' ? (
                <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', minHeight: 30 }]}>
                  <Text style={[ui.small, { color: palette.muted }]}>Estimated minimum</Text>
                  <Text style={[ui.text, { color: palette.text, fontWeight: '700' }]}>
                    {formatCurrency(detailAutoEstimatedMin, currencySymbol)}
                  </Text>
                </View>
              ) : (
                <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', minHeight: 38 }]}>
                  <Text style={[ui.small, { color: palette.muted }]}>Monthly minimum</Text>
                  <View style={detailPillStyle}>
                    <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                    <TextInput
                      editable={canEdit}
                      accessibilityLabel="Minimum payment"
                      style={detailMoneyInputStyle}
                      keyboardType="decimal-pad"
                      value={formatDetailMoneyDisplay(detailDraft.minimumPayment, currencyCode, detailFocusedField === 'minimumPayment')}
                      onFocus={() => setDetailFocusedField('minimumPayment')}
                      onBlur={() => setDetailFocusedField(current => current === 'minimumPayment' ? null : current)}
                      onChangeText={value => { if (canEdit) updateDetailDraft(prev => ({ ...prev, minimumPayment: acceptMoneyEdit(prev.minimumPayment, value, currencyCode) })); }}
                      placeholder={formatEditableMoney(0, currencyCode)}
                      placeholderTextColor={palette.muted}
                    />
                  </View>
                </View>
              )}
            </View>

            {detailDraft.category === 'Mortgage' ? (
              <View style={[detailRowStyle, detailRowBorderStyle]}>
                <Text style={[ui.text, { color: palette.muted }]}>Monthly escrow</Text>
                <View style={detailPillStyle}>
                  <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                  <TextInput
                    editable={canEdit}
                    accessibilityLabel="Monthly escrow"
                    style={detailMoneyInputStyle}
                    keyboardType="decimal-pad"
                    value={formatDetailMoneyDisplay(detailDraft.mortgageEscrow, currencyCode, detailFocusedField === 'mortgageEscrow')}
                    onFocus={() => setDetailFocusedField('mortgageEscrow')}
                    onBlur={() => setDetailFocusedField(current => current === 'mortgageEscrow' ? null : current)}
                    onChangeText={value => { if (canEdit) updateDetailDraft(prev => ({ ...prev, mortgageEscrow: acceptMoneyEdit(prev.mortgageEscrow, value, currencyCode) })); }}
                    placeholder="Optional"
                    placeholderTextColor={palette.muted}
                  />
                </View>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={parsedDetailDueDay ? `Due day: Day ${parsedDetailDueDay}` : 'Due day: Choose day'}
              disabled={!canEdit}
              onPress={() => {
                if (!canEdit) return;
                Keyboard.dismiss();
                setShowDetailDuePicker(true);
              }}
              style={[detailRowStyle, showCreditCardFields ? detailRowBorderStyle : undefined]}
            >
              <Text style={[ui.text, { color: palette.muted }]}>Due day</Text>
              <View style={[detailPillStyle, { minWidth: 116 }]}>
                <Text style={[ui.text, { color: parsedDetailDueDay ? palette.text : palette.brand, fontWeight: '600' }]}>
                  {parsedDetailDueDay ? `Day ${parsedDetailDueDay}` : canEdit ? 'Choose day' : 'Not set'}
                </Text>
                {canEdit ? <AppIcon name="calendar" size={16} color={palette.brand} /> : null}
              </View>
            </Pressable>

            {showCreditCardFields ? (
              <>
                <View style={[detailRowStyle, detailRowBorderStyle]}>
                  <Text style={[ui.text, { color: palette.muted }]}>Credit limit</Text>
                  <View style={detailPillStyle}>
                    <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                    <TextInput
                      editable={canEdit}
                      accessibilityLabel="Credit limit"
                      style={detailMoneyInputStyle}
                      keyboardType="decimal-pad"
                      value={formatDetailMoneyDisplay(detailDraft.creditLimit, currencyCode, detailFocusedField === 'creditLimit')}
                      onFocus={() => setDetailFocusedField('creditLimit')}
                      onBlur={() => setDetailFocusedField(current => current === 'creditLimit' ? null : current)}
                      onChangeText={value => { if (canEdit) updateDetailDraft(prev => ({ ...prev, creditLimit: acceptMoneyEdit(prev.creditLimit, value, currencyCode) })); }}
                      placeholder="Optional"
                      placeholderTextColor={palette.muted}
                    />
                  </View>
                </View>
                <View style={[detailRowStyle, detailRowBorderStyle]}>
                  <Text style={[ui.text, { color: palette.muted }]}>Annual fee</Text>
                  <View style={detailPillStyle}>
                    <Text style={[ui.text, { color: palette.muted, fontWeight: '600' }]}>{currencySymbol}</Text>
                    <TextInput
                      editable={canEdit}
                      accessibilityLabel="Annual fee"
                      style={detailMoneyInputStyle}
                      keyboardType="decimal-pad"
                      value={formatDetailMoneyDisplay(detailDraft.annualFeeAmount, currencyCode, detailFocusedField === 'annualFeeAmount')}
                      onFocus={() => setDetailFocusedField('annualFeeAmount')}
                      onBlur={() => setDetailFocusedField(current => current === 'annualFeeAmount' ? null : current)}
                      onChangeText={value => { if (canEdit) updateDetailDraft(prev => ({ ...prev, annualFeeAmount: acceptMoneyEdit(prev.annualFeeAmount, value, currencyCode) })); }}
                      placeholder="Optional"
                      placeholderTextColor={palette.muted}
                    />
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={detailDraft.annualFeeNextDate ? `Next renewal: ${formatShortDate(detailDraft.annualFeeNextDate)}` : 'Next renewal: Choose date'}
                  disabled={!canEdit}
                  onPress={() => {
                    if (!canEdit) return;
                    Keyboard.dismiss();
                    setShowDetailRenewalPicker(true);
                  }}
                  style={detailRowStyle}
                >
                  <Text style={[ui.text, { color: palette.muted }]}>Next renewal</Text>
                  <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                    <Text style={[ui.text, { color: detailDraft.annualFeeNextDate ? palette.text : palette.brand, fontWeight: '600' }]}>
                      {detailDraft.annualFeeNextDate ? formatShortDate(detailDraft.annualFeeNextDate) : canEdit ? 'Choose date' : 'Not set'}
                    </Text>
                    {canEdit ? <AppIcon name="calendar" size={16} color={palette.brand} /> : null}
                  </View>
                </Pressable>
              </>
            ) : null}

            {canEdit && (detailDirty || !!detailError) && onSaveDebtDetails ? (
              <View style={{ paddingTop: 10, paddingBottom: 10, borderTopWidth: 1, borderTopColor: palette.border, gap: 8 }}>
                {!!detailError ? <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78' }]}>{detailError}</Text> : null}
                {detailDirty ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save account changes"
                    disabled={detailSaving}
                    onPress={() => void saveDetailChanges()}
                    style={{
                      minHeight: 44,
                      borderRadius: 12,
                      backgroundColor: ctaBg,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: detailSaving ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: ctaFg, fontSize: 15, fontWeight: '700' }}>
                      {detailSaving ? 'Saving\u2026' : 'Save changes'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {canEdit ? (
              <View style={{ borderTopWidth: 1, borderTopColor: palette.border, paddingVertical: 8, gap: 10 }}>
                {!reconciling ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Reconcile balance"
                    onPress={startReconcile}
                    style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Text style={[ui.buttonText, { color: palette.brand }]}>Reconcile balance</Text>
                    <AppIcon name="chevronRight" size={15} color={palette.brand} />
                  </Pressable>
                ) : (
                  <View style={{ gap: 8, paddingVertical: 4 }}>
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                      <Text style={ui.heading}>Reconcile balance</Text>
                      <Text style={ui.small}>{`Current: ${formatCurrency(selected.balance, currencySymbol)}`}</Text>
                    </View>
                    {!!reconcileError && <Text accessibilityRole="alert" style={[ui.small, { color: '#F08B78' }]}>{reconcileError}</Text>}
                    <Text style={ui.small}>Statement balance *</Text>
                    <TextInput
                      accessibilityLabel="Statement balance"
                      accessibilityHint="Required"
                      placeholder={formatEditableMoney(0, currencyCode)}
                      placeholderTextColor={palette.muted}
                      keyboardType="decimal-pad"
                      value={reconcileInput}
                      onChangeText={value => {
                        const nextText = acceptMoneyEdit(reconcileInput, value, currencyCode);
                        setReconcileInput(nextText);
                        if (selected) {
                          const nextParsed = parseMoneyInput(nextText, currencyCode, true);
                          const nextDrift = (nextParsed ?? 0) - selected.balance;
                          if (nextDrift < 0) setReconcileReason('credit_adjustment');
                          else if (nextDrift > 0 && reconcileReason === 'credit_adjustment') setReconcileReason('interest_adjustment');
                        }
                      }}
                      style={[ui.input, { color: palette.text, borderColor: palette.border, backgroundColor: isLight ? palette.canvas : palette.raised }]}
                    />
                    <Text style={ui.small}>{`Difference: ${formatCurrency(drift, currencySymbol)}`}</Text>
                    {drift !== 0 && (
                      <View style={{ gap: 6 }}>
                        {(drift > 0 ? ['interest_adjustment', 'balance_adjustment'] as const : ['credit_adjustment'] as const).map(reason => {
                          const selectedReason = reconcileReason === reason;
                          return (
                            <Pressable
                              key={reason}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: selectedReason }}
                              onPress={() => setReconcileReason(reason)}
                              style={[ui.row, { minHeight: 36, gap: 10 }]}
                            >
                              <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: selectedReason ? palette.brand : palette.muted, alignItems: 'center', justifyContent: 'center' }}>
                                {selectedReason ? <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: palette.brand }} /> : null}
                              </View>
                              <Text style={[ui.buttonText, { color: selectedReason ? palette.brand : palette.muted }]}>
                                {reason === 'credit_adjustment' || reason === 'balance_adjustment' ? 'Balance Adjustment' : 'Interest Adjustment'}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                    <View style={[ui.row, { gap: 8 }]}>
                      <Pressable onPress={() => setReconciling(false)} disabled={reconcileBusy} style={[ui.button, { flex: 1, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: palette.border }]}>
                        <Text style={[ui.buttonText, { color: palette.text }]}>Cancel</Text>
                      </Pressable>
                      <Pressable onPress={() => void saveReconcile()} disabled={reconcileBusy} style={[ui.button, { flex: 1, alignItems: 'center', borderRadius: 10, backgroundColor: palette.brand }]}>
                        <Text style={[ui.buttonText, { color: palette.onBrand }]}>{reconcileBusy ? 'Saving\u2026' : 'Save balance'}</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            ) : null}
          </Card>

          {(selected.category === 'Mortgage' || selected.category === 'Auto loan') ? (() => {
            const budgetCategoryLabel = selected.category === 'Mortgage' ? 'Home' : 'Auto';
            const escrow = selected.category === 'Mortgage' ? selectedEscrow : undefined;
            return (
              <Card>
                <Text style={ui.heading}>Budget commitment</Text>
                {isArchivedDebt(selected) ? (
                  <Text style={ui.small}>
                    This paid-off account is archived with its history retained. It is excluded from active monthly Budget totals and upcoming schedules.
                  </Text>
                ) : selected.balance <= 0 ? (
                  <Text style={ui.small}>
                    Excluded from Budget ({budgetCategoryLabel}) while the balance is {formatCurrency(0, currencySymbol)}.
                  </Text>
                ) : (
                  <>
                    <Text style={ui.text}>
                      {`${budgetCategoryLabel} · ${formatCurrency(selected.minimumPayment, currencySymbol)} / month${selected.dueDay !== null ? ` · due day ${selected.dueDay}` : ''}`}
                    </Text>
                    <Text style={ui.small}>
                      {selected.category === 'Mortgage' && escrow !== undefined
                        ? `Synced automatically between Accounts and Budget. Includes ${formatCurrency(escrow, currencySymbol)} escrow; mortgage principal and interest payoff are tracked separately.`
                        : 'Synced automatically between Accounts and Budget. Editing here updates the same obligation in Budget and Scheduled.'}
                    </Text>
                  </>
                )}
                {selectedLinkedBill ? (
                  <>
                    <Text style={ui.small}>
                      {`Legacy linked bill: ${selectedLinkedBill.name} · ${formatCurrency(moneyToMajor(selectedLinkedBill.amount), currencySymbol)} / month · due day ${selectedLinkedBill.dueDay}`}
                    </Text>

                  </>
                ) : selectedPairing?.status === 'linked' ? (
                  <>
                    <Text style={ui.small}>
                      {`Legacy link to ${selectedPairing.billId}, which is unavailable or incompatible. It is not applied to Budget totals or reminders.`}
                    </Text>

                  </>
                ) : null}
              </Card>
            );
          })() : null}

          {canEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete account"
              onPress={() => setDeleteConfirmDebt(selected)}
              style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}
            >
              <Text style={{ color: '#F08B78', fontSize: 15, fontWeight: '600', textAlign: 'center' }}>Delete account</Text>
            </Pressable>
          ) : null}
          </>;
        })()}
        {!!error && <Text accessibilityRole="alert" style={ui.text}>{error}</Text>}
          </ScrollView>
          {section === 'Transactions' && canEdit && onAddTransaction && !showAccountTxModal ? (
            <FloatingAddButton
              onPress={openAccountTxModal}
              label={`Add transaction for ${selected.name}`}
              opacity={detailFabOpacity}
            />
          ) : null}
        </View>}
      </View>
      {selected ? informationSheet : null}

      <AdaptiveModal visible={showDetailCategoryPicker} transparent animationType="fade" onRequestClose={() => setShowDetailCategoryPicker(false)}>
        <TouchableWithoutFeedback onPress={() => setShowDetailCategoryPicker(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
            <TouchableWithoutFeedback>
              <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: palette.border, maxHeight: '72%', paddingBottom: bottomInsetPadding(insets.bottom, 16) }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: palette.border }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: palette.text }}>Select Debt Category</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close picker" onPress={() => setShowDetailCategoryPicker(false)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <AppIcon name="close" size={20} color={palette.muted} />
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ padding: 16, gap: 6 }} keyboardShouldPersistTaps="handled">
                  {detailCategoryOptions.map(option => {
                    const isSelected = option.value === detailDraft.category;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => {
                          updateDetailDraft(prev => ({
                            ...prev,
                            category: option.value,
                            ...(option.value !== 'Credit card'
                              ? { creditLimit: '', annualFeeAmount: '', annualFeeNextDate: '' }
                              : {}),
                          }));
                          setShowDetailCategoryPicker(false);
                        }}
                        style={{
                          minHeight: 52,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: isSelected ? palette.brand : 'transparent',
                          backgroundColor: isSelected ? palette.tint : 'transparent',
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                        }}
                      >
                        <View style={[ui.row, { gap: 10, flex: 1 }]}>
                          {option.icon ? <AppIcon name={option.icon} size={18} color={isSelected ? palette.brand : palette.muted} /> : null}
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: isSelected ? palette.brand : palette.text, fontSize: 15, fontWeight: '600' }}>{option.label}</Text>
                            {option.subtitle ? <Text style={[ui.small, { color: palette.muted }]}>{option.subtitle}</Text> : null}
                          </View>
                        </View>
                        {isSelected ? <AppIcon name="check" size={18} color={palette.brand} /> : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </AdaptiveModal>

      <DueDayPickerModal
        visible={showDetailDuePicker}
        value={detailDraft.dueDay.trim() ? Number(detailDraft.dueDay.trim()) : null}
        title="Select due day"
        subtitle="Monthly payment due date"
        allowClear
        onSelect={day => updateDetailDraft(prev => ({ ...prev, dueDay: day === null ? '' : String(day) }))}
        onClose={() => setShowDetailDuePicker(false)}
      />

      <CalendarDatePickerModal
        visible={showDetailRenewalPicker}
        value={detailDraft.annualFeeNextDate}
        timeZone={householdTimeZone}
        title="Annual fee next renewal"
        allowClear
        onSelect={date => updateDetailDraft(prev => ({ ...prev, annualFeeNextDate: date }))}
        onClose={() => setShowDetailRenewalPicker(false)}
      />

      <AdaptiveModal visible={!!deleteConfirmDebt} transparent animationType="fade" onRequestClose={() => setDeleteConfirmDebt(null)}>
        <TouchableWithoutFeedback onPress={() => setDeleteConfirmDebt(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <TouchableWithoutFeedback>
              {deleteConfirmDebt ? (() => {
                const archived = isArchivedDebt(deleteConfirmDebt);
                const linkedBillId = identityLinkedPairs[deleteConfirmDebt.id];
                const linkedBill = linkedBillId ? recurringBills.find(bill => bill.id === linkedBillId) : undefined;
                const linkedCopy = linkedBill
                  ? ` The linked recurring item \u201c${linkedBill.name}\u201d and its recorded history will also be permanently deleted.`
                  : '';
                const bodyCopy = archived
                  ? `${deleteConfirmDebt.name} is paid off and archived with its history. Keep it archived, or permanently delete it. Once deleted, this account and its recorded transaction and reconciliation history can never be retrieved.`
                  : `Once deleted, ${deleteConfirmDebt.name} and its recorded transaction and reconciliation history can never be retrieved.${linkedCopy}`;
                return (
                  <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 380, backgroundColor: palette.surface, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: 20, gap: 14 }}>
                    <View style={{ alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: isLight ? '#FEE2E2' : 'rgba(240, 139, 120, 0.16)', alignItems: 'center', justifyContent: 'center' }}>
                        <AppIcon name="warning" size={24} color="#F08B78" />
                      </View>
                      <Text accessibilityRole="header" style={[ui.heading, { fontSize: 18, textAlign: 'center' }]}>
                        Delete account and history?
                      </Text>
                      <Text style={[ui.text, { color: palette.muted, textAlign: 'center', lineHeight: 20 }]}>
                        {bodyCopy}
                      </Text>
                    </View>
                    <View style={{ gap: 8, marginTop: 2 }}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={archived ? 'Delete permanently' : 'Delete account and history'}
                        onPress={() => {
                          const target = deleteConfirmDebt;
                          setDeleteConfirmDebt(null);
                          onRemove?.(target);
                        }}
                        style={{ minHeight: 46, borderRadius: 12, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}
                      >
                        <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>
                          {archived ? 'Delete permanently' : 'Delete account & history'}
                        </Text>
                      </Pressable>
                      {archived ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setDeleteConfirmDebt(null)}
                          style={{ minHeight: 44, borderRadius: 12, backgroundColor: palette.tint, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}
                        >
                          <Text style={{ color: palette.brand, fontSize: 15, fontWeight: '600' }}>Keep archived</Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setDeleteConfirmDebt(null)}
                        style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: isLight ? palette.canvas : palette.raised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}
                      >
                        <Text style={{ color: palette.text, fontSize: 15, fontWeight: '600' }}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })() : <View />}
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </AdaptiveModal>



      {selected && canEdit && onAddTransaction && showAccountTxModal ? (
        <AccountQuickTransactionModal
          key={selected.id}
          selected={selected}
          currencyCode={currencyCode}
          currencySymbol={currencySymbol}
          householdTimeZone={householdTimeZone}
          selectedEscrow={selectedEscrow}
          obligationSchedules={obligationSchedules}
          linkedPairBillId={identityLinkedPairs[selected.id]}
          transactions={transactions}
          linkedBillIds={selectedLinkedBillIds}
          onAddTransaction={onAddTransaction}
          onClose={closeAccountTxModal}
        />
      ) : null}
    </AdaptiveModal>
    {showOneTimeDatePicker ? (
      <CalendarDatePickerModal
        visible
        value={oneTimeDate}
        timeZone={householdTimeZone}
        title="One-time preview date"
        onSelect={date => { if (date) setOneTimeDate(date); }}
        onClose={() => setShowOneTimeDatePicker(false)}
      />
    ) : null}
    {!selected ? informationSheet : null}
    </>
  );
});

const AccountQuickTransactionModal = memo(function AccountQuickTransactionModal({
  selected,
  currencyCode,
  currencySymbol,
  householdTimeZone,
  selectedEscrow,
  obligationSchedules,
  linkedPairBillId,
  transactions,
  linkedBillIds,
  onAddTransaction,
  onClose,
}: {
  selected: DebtItem;
  currencyCode: string;
  currencySymbol: string;
  householdTimeZone?: string;
  selectedEscrow?: number;
  obligationSchedules?: ObligationSchedules;
  linkedPairBillId?: string;
  transactions: readonly LedgerTransaction[];
  linkedBillIds?: readonly string[];
  onAddTransaction: (tx: LedgerTransaction) => Promise<unknown> | unknown;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { isLight, palette, ctaBg, ctaFg } = useNativeAppearance();
  const [accountTxCategoryIdx, setAccountTxCategoryIdx] = useState(0);
  const [accountTxDate, setAccountTxDate] = useState(() => currentHouseholdDate(householdTimeZone));
  const [accountTxAppliesToDate, setAccountTxAppliesToDate] = useState('');
  const [accountTxAmount, setAccountTxAmount] = useState('');
  const [accountTxPayee, setAccountTxPayee] = useState('');
  const [accountTxPrincipal, setAccountTxPrincipal] = useState('');
  const [accountTxInterest, setAccountTxInterest] = useState('');
  const [accountTxEscrow, setAccountTxEscrow] = useState('');
  const [accountTxFee, setAccountTxFee] = useState('');
  const [accountTxShowMoreDetails, setAccountTxShowMoreDetails] = useState(false);
  const [showAccountTxCategoryPicker, setShowAccountTxCategoryPicker] = useState(false);
  const [showAccountTxDatePicker, setShowAccountTxDatePicker] = useState(false);
  const [savingAccountTx, setSavingAccountTx] = useState(false);
  const savingAccountTxRef = useRef(false);
  const [accountTxError, setAccountTxError] = useState('');

  const chosenCat = ACCOUNT_TX_CATEGORY_CHOICES[accountTxCategoryIdx] ?? ACCOUNT_TX_CATEGORY_CHOICES[0];
  const dueCycleOptions = useMemo<readonly DropdownOption<string>[]>(() => {
    const hhMonth = currentHouseholdMonth(householdTimeZone);
    const schedule = resolveEffectiveDebtSchedule(obligationSchedules, selected.id, linkedPairBillId ? [linkedPairBillId] : []);
    return [
      { value: '', label: 'No due cycle', subtitle: 'Leave this payment unassigned to a due date' },
      ...[0, 1, 2].flatMap(monthOffset => {
        let month = hhMonth;
        for (let offset = 0; offset < monthOffset; offset++) month = getNextMonthString(month);
        const cycle = schedule ? getObligationCycle(schedule, month) : undefined;
        if (cycle === null || (!schedule && !selected.dueDay)) return [];
        const date = cycle?.dueDate ?? resolveRecurringBillDate(month, selected.dueDay!);
        const label = formatShortDate(date);
        return {
          value: date,
          label: `Due ${label}`,
          subtitle: selected.dueDay ? `Apply this payment to ${label}` : `Link this payment to the ${label} cycle`,
        };
      }),
    ];
  }, [householdTimeZone, linkedPairBillId, obligationSchedules, selected.dueDay, selected.id]);

  const saveAccountTx = async () => {
    if (savingAccountTx || savingAccountTxRef.current) return;
    setAccountTxError('');
    const parsedAmt = parseMoneyInput(accountTxAmount, currencyCode, false);
    if (parsedAmt === null || parsedAmt <= 0) {
      setAccountTxError('Please enter a valid amount');
      return;
    }

    savingAccountTxRef.current = true;
    setSavingAccountTx(true);
    try {
      const actualDate = parseDateOnly(accountTxDate.trim());
      const appliesToDate = accountTxAppliesToDate.trim() ? parseDateOnly(accountTxAppliesToDate.trim()) : null;
      const moneyAmount = parseMoney(accountTxAmount, currencyCode);

      const principalAmount = accountTxPrincipal.trim() ? parseMoney(accountTxPrincipal.trim(), currencyCode) : null;
      const interestAmount = accountTxInterest.trim() ? parseMoney(accountTxInterest.trim(), currencyCode) : null;
      const escrowAmount = accountTxEscrow.trim() ? parseMoney(accountTxEscrow.trim(), currencyCode) : null;
      const feeAmount = accountTxFee.trim() ? parseMoney(accountTxFee.trim(), currencyCode) : null;

      const tx: LedgerTransaction = {
        id: `tx:${Crypto.randomUUID()}`,
        accountId: selected.id,
        date: actualDate,
        appliesToDate,
        amount: moneyAmount,
        category: chosenCat.category,
        payee: accountTxPayee.trim() || (chosenCat.category === 'payment' ? 'Payment' : chosenCat.label),
        memo: `Manual entry (${chosenCat.label})`,
        source: 'manual',
        reconciled: false,
        createdAt: new Date().toISOString(),
        deletedAt: null,
        principalAmount,
        interestAmount,
        escrowAmount,
        feeAmount,
      };

      const res = await onAddTransaction(tx);
      if (res && (res as { outcome?: string }).outcome === 'pending') {
        Alert.alert(
          'Saved Locally (Pending Confirmation)',
          'Transaction recorded locally. Confirmation will be verified upon connecting to the server.',
        );
      }
      onClose();
    } catch (e) {
      const msg = (e as Error).message || 'Unable to save transaction';
      setAccountTxError(msg);
      if (msg.includes('conflict') || msg.includes('Conflict')) {
        Alert.alert('Save Conflict', msg);
      }
    } finally {
      savingAccountTxRef.current = false;
      setSavingAccountTx(false);
    }
  };

  return (
    <SheetModal
      visible
      onClose={onClose}
      contentSized
      closeLabel="Dismiss form"
      footer={(
        <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface }}>
          <Pressable
            accessibilityRole="button"
            disabled={savingAccountTx}
            onPress={() => { void saveAccountTx(); }}
            style={[ui.button, { minHeight: 46, backgroundColor: ctaBg, borderColor: ctaBg, justifyContent: 'center', opacity: savingAccountTx ? 0.65 : 1 }]}
          >
            <Text style={[ui.buttonText, { color: ctaFg, fontSize: 15, fontWeight: '700', textAlign: 'center' }]}>
              {savingAccountTx ? 'Saving\u2026' : 'Save Transaction'}
            </Text>
          </Pressable>
        </View>
      )}
    >
      <View style={{ gap: 10 }}>
        <SheetFormHeader
          title="Add transaction"
          subtitle={`${selected.name} \u00b7 ${selected.category}`}
          centered
          onClose={onClose}
          closeLabel="Dismiss form"
        />

        {!!accountTxError && (
          <Text accessibilityRole="alert" style={[ui.small, { color: appearanceColor('#F08B78', isLight) }]}>{accountTxError}</Text>
        )}

        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: isLight ? palette.surface : palette.raised, paddingHorizontal: 15, overflow: 'hidden' }}>
          <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 }}>
            <Text style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>Account</Text>
            <Text numberOfLines={1} style={{ color: palette.muted, fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>
              {selected.name}
            </Text>
          </View>

          <View style={{ height: 1, backgroundColor: palette.border }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Transaction category: ${chosenCat.label}`}
            accessibilityHint="Required"
            onPress={() => setShowAccountTxCategoryPicker(true)}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 }}
          >
            <Text style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>Transaction category *</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
              <Text numberOfLines={1} style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>{chosenCat.label}</Text>
              <AppIcon name="chevronDown" size={14} color={palette.muted} />
            </View>
          </Pressable>

          <View style={{ height: 1, backgroundColor: palette.border }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Transaction date: ${accountTxDate}`}
            accessibilityHint="Required"
            onPress={() => setShowAccountTxDatePicker(true)}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 }}
          >
            <Text style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>Transaction date *</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Text style={{ color: palette.brand, fontSize: 15, fontWeight: '600' }}>
                {formatShortDate(accountTxDate)}
              </Text>
              <AppIcon name="calendar" size={16} color={palette.brand} />
            </View>
          </Pressable>

          <View style={{ height: 1, backgroundColor: palette.border }} />
          <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 2 }}>
            <Text style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>Amount *</Text>
            <TextInput
              accessibilityLabel="Transaction amount"
              accessibilityHint="Required"
              placeholder={formatEditableMoney(0, currencyCode)}
              placeholderTextColor={palette.muted}
              keyboardType="decimal-pad"
              textAlign="right"
              value={accountTxAmount}
              onChangeText={val => setAccountTxAmount(prev => acceptMoneyEdit(prev, val, currencyCode))}
              style={{ flex: 1, minWidth: 96, minHeight: 44, paddingVertical: 8, paddingHorizontal: 0, textAlign: 'right', color: palette.text, fontSize: 15, fontWeight: '600' }}
            />
          </View>

          <View style={{ height: 1, backgroundColor: palette.border }} />
          <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={{ color: palette.text, fontSize: 15, fontWeight: '500' }}>Add a note</Text>
              <Text style={{ color: palette.muted, fontSize: 12 }}>optional</Text>
            </View>
            <TextInput
              accessibilityLabel="Add a note"
              placeholder="Optional note"
              placeholderTextColor={palette.muted}
              textAlign="right"
              value={accountTxPayee}
              onChangeText={setAccountTxPayee}
              style={{ flex: 1, minWidth: 96, minHeight: 44, paddingVertical: 8, paddingHorizontal: 0, textAlign: 'right', color: palette.text, fontSize: 14 }}
            />
          </View>
        </View>

        {accountTxAmount ? (() => {
          try {
            const amount = parseMoney(accountTxAmount, currencyCode);
            if (moneyToMajor(amount) <= 0) return null;
            const preview: LedgerTransaction = {
              id: 'preview',
              accountId: selected.id,
              date: parseDateOnly(accountTxDate.trim()),
              appliesToDate: null,
              amount,
              category: chosenCat.category,
              payee: '',
              memo: '',
              source: 'manual',
              reconciled: false,
              createdAt: '',
              deletedAt: null,
              principalAmount: accountTxPrincipal.trim() ? parseMoney(accountTxPrincipal, currencyCode) : null,
              interestAmount: accountTxInterest.trim() ? parseMoney(accountTxInterest, currencyCode) : null,
              escrowAmount: accountTxEscrow.trim() ? parseMoney(accountTxEscrow, currencyCode) : null,
              feeAmount: accountTxFee.trim() ? parseMoney(accountTxFee, currencyCode) : null,
            };
            const after = addMoney(moneyFromMajor(selected.balance, currencyCode), calculateTransactionBalanceDelta(preview, selected.category));
            return (
              <View style={[ui.row, { justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: palette.tint }]}>
                <View><Text style={ui.small}>Current balance</Text><Text style={ui.heading}>{formatCurrency(selected.balance, currencySymbol)}</Text></View>
                <AppIcon name="chevronRight" size={16} color={palette.brand} />
                <View style={{ alignItems: 'flex-end' }}><Text style={ui.small}>After saving</Text><Text style={ui.heading}>{formatCurrency(moneyToMajor(after), currencySymbol)}</Text></View>
              </View>
            );
          } catch {
            return null;
          }
        })() : null}

        {chosenCat.category === 'payment' ? (
          <View style={{ gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: accountTxShowMoreDetails }}
              onPress={() => setAccountTxShowMoreDetails(prev => !prev)}
              style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}
            >
              <Text style={{ color: palette.brand, fontSize: 14, fontWeight: '600' }}>More details</Text>
              <AppIcon name={accountTxShowMoreDetails ? 'chevronDown' : 'chevronRight'} size={15} color={palette.brand} />
            </Pressable>

            {accountTxShowMoreDetails ? (
              <View style={{ gap: 10 }}>
                <SelectDropdown
                  label="Applies to payment cycle (optional)"
                  sheetTitle="Choose Payment Due Cycle"
                  value={accountTxAppliesToDate}
                  options={dueCycleOptions}
                  onSelect={setAccountTxAppliesToDate}
                  placeholder="Choose a due cycle"
                />

                {(selected.category === 'Mortgage' || selected.category === 'Auto loan') ? (
                  <View style={{ padding: 12, backgroundColor: palette.raised, borderRadius: 12, borderWidth: 1, borderColor: palette.border, gap: 6 }}>
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 8 }]}>
                      <Text style={[ui.small, { color: appearanceColor('#76DCB9', isLight), fontWeight: '700', flex: 1 }]}>PAYMENT BREAKDOWN (OPTIONAL)</Text>
                      {canSuggestLoanPaymentSplit(selected, selected.category === 'Mortgage' ? selectedEscrow : undefined) ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Suggest principal and interest split"
                          onPress={() => {
                            const parsedAmt = parseMoneyInput(accountTxAmount, currencyCode, false);
                            const targetAmount = parsedAmt !== null && parsedAmt > 0 ? parsedAmt : selected.minimumPayment;
                            if (!Number.isFinite(targetAmount) || targetAmount <= 0) return;
                            if (parsedAmt === null || parsedAmt <= 0) {
                              setAccountTxAmount(formatEditableMoney(targetAmount, currencyCode));
                            }
                            let suggestion;
                            if (selected.category === 'Auto loan') {
                              let paymentDate = currentHouseholdDate(householdTimeZone);
                              try {
                                paymentDate = parseDateOnly(accountTxDate.trim());
                              } catch {
                                // Fallback to household today if draft date is invalid.
                              }
                              suggestion = resolveAutoLoanSplitSuggestion({
                                debt: selected,
                                paymentAmount: targetAmount,
                                paymentDate,
                                transactions,
                                currencyCode,
                                linkedBillIds,
                              }).suggestion;
                            } else {
                              suggestion = suggestLoanPaymentSplit({
                                balance: selected.balance,
                                aprPercent: selected.apr,
                                paymentAmount: targetAmount,
                                escrowAmount: selected.category === 'Mortgage' ? selectedEscrow : undefined,
                                currencyCode,
                              });
                            }
                            setAccountTxPrincipal(formatEditableMoney(suggestion.principal, currencyCode));
                            setAccountTxInterest(formatEditableMoney(suggestion.interest, currencyCode));
                            if (selected.category === 'Mortgage') {
                              setAccountTxEscrow(formatEditableMoney(suggestion.escrow, currencyCode));
                            }
                          }}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: palette.brand,
                            backgroundColor: palette.tint,
                          }}
                        >
                          <Text style={[ui.small, { color: palette.brand, fontWeight: '700' }]}>Suggest P/I split</Text>
                        </Pressable>
                      ) : selected.category === 'Mortgage' && selectedEscrow === undefined ? (
                        <Text style={[ui.small, { color: palette.muted }]}>Set monthly escrow to suggest split</Text>
                      ) : null}
                    </View>
                    <Text style={[ui.small, { color: palette.muted, marginBottom: 4 }]}>
                      If unknown, full payment is recorded in cashflow while loan principal remains unchanged.
                    </Text>
                    <Text style={ui.small}>Principal reduction</Text>
                    <TextInput
                      placeholder={formatEditableMoney(0, currencyCode)}
                      placeholderTextColor={palette.muted}
                      keyboardType="decimal-pad"
                      value={accountTxPrincipal}
                      onChangeText={val => setAccountTxPrincipal(prev => acceptMoneyEdit(prev, val, currencyCode))}
                      style={[ui.input, { backgroundColor: palette.surface, borderColor: palette.inputBorder, color: palette.text }]}
                    />
                    <Text style={[ui.small, { marginTop: 4 }]}>Interest paid</Text>
                    <TextInput
                      placeholder={formatEditableMoney(0, currencyCode)}
                      placeholderTextColor={palette.muted}
                      keyboardType="decimal-pad"
                      value={accountTxInterest}
                      onChangeText={val => setAccountTxInterest(prev => acceptMoneyEdit(prev, val, currencyCode))}
                      style={[ui.input, { backgroundColor: palette.surface, borderColor: palette.inputBorder, color: palette.text }]}
                    />
                    {selected.category === 'Mortgage' ? (
                      <>
                        <Text style={[ui.small, { marginTop: 4 }]}>Escrow (taxes & insurance)</Text>
                        <TextInput
                          placeholder={formatEditableMoney(0, currencyCode)}
                          placeholderTextColor={palette.muted}
                          keyboardType="decimal-pad"
                          value={accountTxEscrow}
                          onChangeText={val => setAccountTxEscrow(prev => acceptMoneyEdit(prev, val, currencyCode))}
                          style={[ui.input, { backgroundColor: palette.surface, borderColor: palette.inputBorder, color: palette.text }]}
                        />
                      </>
                    ) : null}
                    <Text style={[ui.small, { marginTop: 4 }]}>Fees</Text>
                    <TextInput
                      placeholder={formatEditableMoney(0, currencyCode)}
                      placeholderTextColor={palette.muted}
                      keyboardType="decimal-pad"
                      value={accountTxFee}
                      onChangeText={val => setAccountTxFee(prev => acceptMoneyEdit(prev, val, currencyCode))}
                      style={[ui.input, { backgroundColor: palette.surface, borderColor: palette.inputBorder, color: palette.text }]}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        <AdaptiveModal visible={showAccountTxCategoryPicker} transparent animationType="fade" onRequestClose={() => setShowAccountTxCategoryPicker(false)}>
          <TouchableWithoutFeedback onPress={() => setShowAccountTxCategoryPicker(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.72)', justifyContent: 'flex-end' }}>
              <TouchableWithoutFeedback>
                <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: palette.border, maxHeight: '75%', paddingBottom: bottomInsetPadding(insets.bottom, 16) }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: palette.border }}>
                    <Text style={{ fontSize: 17, fontWeight: '700', color: palette.text }}>Select Transaction Category</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Close picker"
                      onPress={() => setShowAccountTxCategoryPicker(false)}
                      style={{ width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <AppIcon name="close" size={20} color={palette.muted} />
                    </Pressable>
                  </View>
                  <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10 }} keyboardShouldPersistTaps="handled">
                    {ACCOUNT_TX_CATEGORY_CHOICES.map((option, idx) => {
                      const isSelected = idx === accountTxCategoryIdx;
                      return (
                        <Pressable
                          key={option.category}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => { setAccountTxCategoryIdx(idx); setShowAccountTxCategoryPicker(false); }}
                          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, marginVertical: 3, ...(isSelected ? { backgroundColor: palette.tint, borderWidth: 1, borderColor: palette.border } : {}) }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                            <AppIcon name={option.icon} size={20} color={isSelected ? palette.brand : palette.muted} style={{ marginRight: 12 }} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 15, fontWeight: isSelected ? '700' : '500', color: isSelected ? palette.brand : palette.text }}>{option.label}</Text>
                              <Text style={{ fontSize: 12, color: palette.muted, marginTop: 2 }}>{option.subtitle}</Text>
                            </View>
                          </View>
                          {isSelected ? <AppIcon name="check" size={20} color={palette.brand} /> : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </AdaptiveModal>

        <CalendarDatePickerModal
          visible={showAccountTxDatePicker}
          value={accountTxDate}
          timeZone={householdTimeZone}
          title="Transaction date"
          onSelect={date => { if (date) setAccountTxDate(date); }}
          onClose={() => setShowAccountTxDatePicker(false)}
        />
      </View>
    </SheetModal>
  );
});

function ExtraAmountRow({
  label,
  rawDraft,
  focused,
  editable,
  unitLabel,
  inputAccessibilityLabel,
  minusAccessibilityLabel,
  plusAccessibilityLabel,
  clearAccessibilityLabel,
  inputRef,
  canDecrement,
  currencyCode,
  currencySymbol,
  headerRight,
  onFocus,
  onBlur,
  onChangeText,
  onClear,
  onStep,
  onSubmitEditing,
}: {
  label: string;
  rawDraft: string;
  focused: boolean;
  editable: boolean;
  unitLabel: string;
  inputAccessibilityLabel: string;
  minusAccessibilityLabel: string;
  plusAccessibilityLabel: string;
  clearAccessibilityLabel: string;
  inputRef: React.RefObject<ComponentRef<typeof TextInput> | null>;
  canDecrement: boolean;
  currencyCode: string;
  currencySymbol: string;
  headerRight?: ReactNode;
  onFocus: () => void;
  onBlur: () => void;
  onChangeText: (value: string) => void;
  onClear: () => void;
  onStep: (deltaDirection: -1 | 1) => void;
  onSubmitEditing: () => void;
}) {
  const { isLight, isInspire, palette } = useNativeAppearance();
  const displayValue = focused ? rawDraft : formatDetailMoneyDisplay(rawDraft, currencyCode, false);
  const circleStyle = (disabled: boolean) => ({
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: isInspire ? 1.5 : 1,
    borderColor: palette.cardBorder,
    backgroundColor: isLight ? palette.surface : palette.raised,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    opacity: disabled ? 0.38 : 1,
  });

  return (
    <View style={{ gap: 6 }}>
      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 8 }]}>
        <Text style={[ui.small, { color: palette.muted, fontWeight: '700' }]}>{label}</Text>
        {headerRight ?? null}
      </View>
      <View style={[ui.row, { gap: 10, alignItems: 'center' }]}>
        <View
          style={[
            ui.row,
            {
              flex: 1,
              minWidth: 0,
              gap: 6,
              paddingHorizontal: 10,
              minHeight: 42,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: focused ? palette.brand : palette.border,
              backgroundColor: isLight ? palette.canvas : palette.raised,
              opacity: editable ? 1 : 0.7,
              alignItems: 'center',
            },
          ]}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: palette.muted }}>{currencySymbol}</Text>
          <TextInput
            ref={inputRef}
            editable={editable}
            accessibilityLabel={inputAccessibilityLabel}
            keyboardType="decimal-pad"
            returnKeyType="done"
            underlineColorAndroid="transparent"
            placeholder={formatEditableMoney(0, currencyCode)}
            placeholderTextColor={palette.muted}
            value={displayValue}
            onFocus={onFocus}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmitEditing}
            onBlur={onBlur}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 40,
              paddingVertical: 4,
              color: palette.text,
              fontSize: 18,
              fontWeight: '700',
              borderWidth: 0,
              backgroundColor: 'transparent',
              paddingHorizontal: 0,
              fontVariant: ['tabular-nums'],
            }}
          />
          {focused && rawDraft.length > 0 && editable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={clearAccessibilityLabel}
              hitSlop={6}
              onPress={onClear}
              style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}
            >
              <AppIcon name="close" size={13} color={palette.muted} />
            </Pressable>
          ) : null}
          <Text style={[ui.small, { color: palette.muted, fontWeight: '600', flexShrink: 0 }]}>{unitLabel}</Text>
        </View>
        <View style={[ui.row, { gap: 8, alignItems: 'center', flexShrink: 0 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={minusAccessibilityLabel}
            hitSlop={4}
            disabled={!editable || !canDecrement}
            onPress={() => onStep(-1)}
            style={circleStyle(!editable || !canDecrement)}
          >
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
              <Path d="M5.5 12h13" stroke={palette.text} strokeWidth={2.4} strokeLinecap="round" />
            </Svg>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={plusAccessibilityLabel}
            hitSlop={4}
            disabled={!editable}
            onPress={() => onStep(1)}
            style={circleStyle(!editable)}
          >
            <AppIcon name="plus" size={15} color={palette.text} strokeWidth={2.4} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ScenarioAllocationRow({ account, item, category, index, currencySymbol, onBeforeToggle }: {
  account?: PayoffPlanResult['payoffOrder'][number];
  item?: import('../onboarding-domain').ScenarioPaymentAccount;
  category?: DebtCategory;
  index: number;
  currencySymbol: string;
  onBeforeToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { isInspire, palette } = useNativeAppearance();
  const name = item?.name ?? account?.name ?? '';
  const payment = formatCurrency(item?.totalPaid ?? 0, currencySymbol);
  const parts: string[] = [];
  if (item) {
    if (item.minimumPaid > 0 || (item.scenarioExtraPaid === 0 && item.minimumRolloverPaid === 0)) parts.push(`${item.inclusion === 'minimum-only' ? 'Min only' : 'Minimum'} ${formatCurrency(item.minimumPaid, currencySymbol)}`);
    if (item.scenarioExtraPaid > 0) parts.push(`${formatCurrency(item.scenarioExtraPaid, currencySymbol)} extra`);
    if (item.minimumRolloverPaid > 0) parts.push(`${formatCurrency(item.minimumRolloverPaid, currencySymbol)} rollover`);
  } else {
    parts.push('No payment this month');
  }
  const firstBalance = item?.closingBalance ?? account?.monthlySchedule[0]?.balance;
  const remaining = item?.paidOff ? 'Paid off' : firstBalance === undefined ? 'Balance unavailable' : `${formatCurrency(firstBalance, currencySymbol)} left`;
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, paddingVertical: 8 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${index + 1}. ${name}, ${account ? formatCurrency(account.balance, currencySymbol) : 'balance unavailable'}`} accessibilityHint="Toggles payment details and schedule" onPress={() => { onBeforeToggle(); setExpanded(open => !open); }} style={[ui.row, { gap: 10, minHeight: 44, alignItems: 'center' }]}>
        <View style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          backgroundColor: isInspire ? palette.surface : palette.raised,
          borderWidth: isInspire ? 1.5 : 0,
          borderColor: palette.cardBorder,
          alignItems: 'center',
          justifyContent: 'center',
        }}><Text style={{ color: isInspire ? palette.accentInk : palette.text, fontWeight: '700' }}>{index + 1}</Text></View>
        <AccountMark name={name} category={category} size={38} />
        <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: palette.text }}>{name}</Text><Text style={[ui.small, { color: palette.muted }]}>{account ? <><Text style={{ color: account.apr < 15 ? palette.posInk : palette.neg }}>{account.apr.toFixed(2)}%</Text> APR</> : 'APR unavailable'}</Text></View>
        <View style={{ alignItems: 'flex-end', flexShrink: 1, gap: 3 }}>
          <AmountText style={{ fontSize: 14, fontWeight: '700', color: palette.text }} value={account ? formatCurrency(account.balance, currencySymbol) : 'Unavailable'} />
          <View style={{
            backgroundColor: palette.selection,
            borderWidth: isInspire ? 1.5 : 0,
            borderColor: palette.cardBorder,
            borderRadius: 8,
            paddingHorizontal: 9,
            paddingVertical: 3.5,
          }}><Text numberOfLines={1} style={{ color: palette.selectionInk, fontSize: 11.5, fontWeight: '700' }}>{account?.projectedPayoffLabel ?? 'Unavailable'}</Text></View>
        </View>
      </Pressable>
      {expanded ? <View style={{ paddingTop: 8, gap: 4 }}>
        <Text style={[ui.small, { color: palette.text, fontWeight: '700' }]}>{`First payment: ${payment}`}</Text>
        <Text style={[ui.small, { color: palette.muted }]}>{parts.join(' + ')}</Text>
        <Text style={[ui.small, { color: palette.muted }]}>{`After first payment: ${remaining}`}</Text>
        {account ? <ProjectionSchedule account={account} currencySymbol={currencySymbol} /> : <Text style={ui.small}>Projection unavailable.</Text>}
      </View> : null}
    </View>
  );
}

function ProjectionSchedule({ account, currencySymbol }: { account: PayoffPlanResult['payoffOrder'][number]; currencySymbol: string }) {
  const { palette } = useNativeAppearance();
  return (
      <View style={{ backgroundColor: palette.raised, borderRadius: 12, padding: 10, marginTop: 10 }}>
        <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled>
          <View style={[ui.row, { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border }]}>{['Month', 'Payment', 'Interest', 'Balance'].map((label, column) => <Text key={label} style={[ui.small, { flex: 1, fontWeight: '700', textAlign: column ? 'right' : 'left' }]}>{label}</Text>)}</View>
          {account.monthlySchedule.map((row, rowIndex) => <View key={`${account.id}-${rowIndex}`} style={[ui.row, { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border }]}><Text style={[ui.text, { flex: 1, fontSize: 13 }]}>{row.month}</Text><Text style={[ui.text, { flex: 1, fontSize: 13, textAlign: 'right' }]}>{formatCurrency(row.payment, currencySymbol)}</Text><Text style={[ui.text, { flex: 1, fontSize: 13, textAlign: 'right' }]}>{formatCurrency(row.interest, currencySymbol)}</Text><Text style={[ui.text, { flex: 1, fontSize: 13, textAlign: 'right' }]}>{formatCurrency(row.balance, currencySymbol)}</Text></View>)}
          {!account.monthlySchedule.length ? <Text style={ui.small}>Projection unavailable.</Text> : null}
        </ScrollView>
      </View>
  );
}

function ProjectionRow({
  account,
  category,
  index,
  showDivider = true,
  currencySymbol,
  compact = false,
  onBeforeToggle,
}: {
  account: PayoffPlanResult['payoffOrder'][number];
  category?: DebtCategory;
  index: number;
  showDivider?: boolean;
  currencySymbol: string;
  compact?: boolean;
  onBeforeToggle?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { isInspire, palette } = useNativeAppearance();
  const payoffBadgeText = compact && account.monthsToPayoff !== null
    ? `${account.projectedPayoffLabel} · ${account.monthsToPayoff} mo`
    : account.projectedPayoffLabel;

  return (
    <View style={{ borderBottomWidth: showDivider ? StyleSheet.hairlineWidth : 0, borderBottomColor: palette.border, paddingVertical: compact ? 10 : 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${index + 1}. ${account.name}, ${payoffBadgeText}`}
        onPress={() => {
          onBeforeToggle?.();
          setExpanded(!expanded);
        }}
        style={[ui.row, { justifyContent: 'space-between', gap: compact ? 10 : 12, alignItems: 'center' }]}
      >
        <View
          style={{
            width: compact ? 26 : 30,
            height: compact ? 26 : 30,
            borderRadius: 8,
            backgroundColor: isInspire ? palette.surface : palette.raised,
            borderWidth: isInspire ? 1.5 : 0,
            borderColor: palette.cardBorder,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: isInspire ? palette.accentInk : palette.text, fontSize: compact ? 12 : 13, fontWeight: '700' }}>{index + 1}</Text>
        </View>
        {!compact ? <AccountMark name={account.name} category={category} size={38} /> : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={[ui.heading, { fontSize: compact ? 14 : 15.5 }]}>{account.name}</Text>
          <Text numberOfLines={1} style={[ui.small, { fontSize: compact ? 12 : 13 }]}><Text style={{ color: account.apr < 15 ? palette.posInk : palette.neg }}>{account.apr.toFixed(2)}%</Text> APR</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <AmountText style={[ui.value, { fontSize: compact ? 14 : 15.5, fontWeight: '700', color: palette.text }]} value={formatCurrency(account.balance, currencySymbol)} />
          <View style={{
            paddingHorizontal: compact ? 8 : 10,
            paddingVertical: 3.5,
            borderRadius: 8,
            backgroundColor: palette.selection,
            borderWidth: isInspire ? 1.5 : 0,
            borderColor: palette.cardBorder,
          }}>
            <Text style={{ color: palette.selectionInk, fontSize: compact ? 11 : 12, fontWeight: '700' }}>{payoffBadgeText}</Text>
          </View>
        </View>
      </Pressable>
      {expanded ? <ProjectionSchedule account={account} currencySymbol={currencySymbol} /> : null}
    </View>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return <View style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}><Text style={[ui.small, { flex: 1, minWidth: 0 }]}>{label}</Text><Text style={[ui.heading, { fontSize: 15, textAlign: 'right', flex: 1 }]}>{value}</Text></View>;
}
