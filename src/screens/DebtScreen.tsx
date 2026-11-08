import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Modal } from 'react-native';
import { Pressable, ScrollView, Text, TextInput, View } from '../components/NativeAppearance';
import Svg, { Defs, LinearGradient, Path, Stop, Circle } from 'react-native-svg';
import { Bar, Card, categoryDebts, FinancialScreen, Segments, snapshot, ui } from '../components/FinancialScreen';
import { AppIcon } from '../components/AppIcon';
import { calculateIndependentMortgageProjections, formatCurrency, acceptMoneyEdit, type DebtItem, type LoanBillPairing, type PayoffPlanResult } from '../onboarding-domain';
import { type LedgerTransaction, type ReconciliationAnchor, classifyCategoryDirection } from '../finance/ledger';
import { moneyToMajor } from '../finance/money';
import { SelectDropdown, type DropdownOption } from '../components/SelectDropdown';
import { validateExtraPaymentInput, formatEditableMoney, type PayoffStrategy } from '../onboarding-domain';
import { SheetModal } from '../components/SheetModal';
import { activeLoanBillLinks, compatibleLoanBills } from '../finance/loan-bill-pairing';
import type { RecurringBill } from '../finance/recurring-bills';

const filters = ['Cards & Loans', 'Home & Auto', 'All Debts'] as const;
const sortOptions: readonly DropdownOption<number>[] = [
  { value: 0, label: 'Name', icon: 'sort' }, { value: 1, label: 'Balance', icon: 'sort' },
  { value: 2, label: 'APR', icon: 'sort' }, { value: 3, label: 'Payoff', icon: 'calendar' },
];
const sorts = ['Name', 'Balance', 'APR', 'Payoff'] as const;
const detailSections = ['Overview', 'Transactions', 'Detail'] as const;
const txPeriods = ['Current month', 'Previous month', 'Lifetime'] as const;
const txPeriodOptions: readonly DropdownOption<string>[] = txPeriods.map(value => ({ value, label: value, icon: 'calendar' }));

function BalanceSparkline({
  selected,
  anchors,
  currencySymbol,
}: {
  selected: DebtItem;
  anchors: ReconciliationAnchor[];
  currencySymbol: string;
}) {
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
          <Text style={ui.heading}>Balance history & statement records</Text>
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
              <Stop offset="0%" stopColor="#81DFD2" stopOpacity="0.3" />
              <Stop offset="100%" stopColor="#81DFD2" stopOpacity="0.0" />
            </LinearGradient>
          </Defs>
          <Path d={areaPath} fill="url(#sparklineGrad)" />
          <Path d={linePath} fill="none" stroke="#81DFD2" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {coords.map((c, i) => (
            <Circle key={i} cx={c.x} cy={c.y} r={3.5} fill="#81DFD2" stroke="#1F201F" strokeWidth={1.5} />
          ))}
        </Svg>
      </View>

      <View style={[ui.row, { justifyContent: 'space-between', marginTop: 4 }]}>
        <View>
          <Text style={ui.small}>Starting balance</Text>
          <Text style={[ui.value, { fontSize: 13 }]}>{formatCurrency(startBalance, currencySymbol)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={ui.small}>Current balance</Text>
          <Text style={[ui.value, { fontSize: 13, color: currentBalance <= startBalance ? '#81DFD2' : '#E3A088' }]}>
            {formatCurrency(currentBalance, currencySymbol)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

export function DebtScreen({
  debts, plan, currencySymbol, editor, error, transactions, reconciliationAnchors = [],
  currencyCode = 'USD',
  onAdd, onEdit, onRemove, onReconcile, onSettings, initialSelectedId, initialSection, onDismiss,
  strategy = plan.strategy, extraMonthlyPayment = plan.extraMonthlyPayment, onStrategy, onExtra,
  mortgageEscrowByDebtId = {}, mortgageExtraPaymentByDebtId = {}, onMortgageExtra,
  recurringBills = [], loanBillPairings = {}, onSaveLoanBillPairings,
}: {
  debts: DebtItem[];
  plan: PayoffPlanResult;
  currencySymbol: string;
  editor: ReactNode;
  error: string;
  transactions: LedgerTransaction[];
  reconciliationAnchors?: ReconciliationAnchor[];
  currencyCode?: string;
  onAdd: () => void;
  onEdit: (item: DebtItem) => void;
  onRemove: (item: DebtItem) => void;
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
  onDismiss?: () => void;
}) {
  const [filter, setFilter] = useState<string>(filters[0]);
  const [view, setView] = useState(initialSection === 'Strategy' ? 'Strategy' : 'Accounts');
  const [strategyType, setStrategyType] = useState<'Debt strategy' | 'Mortgage strategy'>('Debt strategy');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(0);
  const [extraDraft, setExtraDraft] = useState(formatEditableMoney(extraMonthlyPayment, currencyCode));
  const [strategyError, setStrategyError] = useState('');
  const [strategyBusy, setStrategyBusy] = useState(false);
  const [extraBusy, setExtraBusy] = useState(false);
  const [mortgageExtraDrafts, setMortgageExtraDrafts] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [section, setSection] = useState<string>(detailSections[0]);
  const [txPeriod, setTxPeriod] = useState<string>(txPeriods[0]);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileInput, setReconcileInput] = useState('');
  const [reconcileReason, setReconcileReason] = useState<'interest_adjustment' | 'balance_adjustment' | 'credit_adjustment'>('interest_adjustment');
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileError, setReconcileError] = useState('');
  const [pairingChoice, setPairingChoice] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState('');

  useEffect(() => setExtraDraft(formatEditableMoney(extraMonthlyPayment, currencyCode)), [extraMonthlyPayment, currencyCode]);
  useEffect(() => {
    setView(initialSection === 'Strategy' ? 'Strategy' : 'Accounts');
    if (initialSection === 'Strategy') setSelectedId(null);
  }, [initialSection]);

  const [prevInitialId, setPrevInitialId] = useState(initialSelectedId);
  if (initialSelectedId !== prevInitialId) {
    setPrevInitialId(initialSelectedId);
    if (initialSelectedId !== undefined && initialSelectedId !== null) {
      setSelectedId(initialSelectedId);
      setSection('Overview');
    }
  }

  const scoped = categoryDebts(debts, filter);
  const stats = snapshot(scoped);
  const mortgageDebts = debts.filter(item => item.category === 'Mortgage');
  const mortgagePlans = calculateIndependentMortgageProjections(debts, strategy, mortgageEscrowByDebtId, mortgageExtraPaymentByDebtId, new Date(), currencyCode);
  const mortgageProjectionById = new Map(mortgagePlans.map(row => [row.debt.id, row.projection]));
  const projectionFor = (debt: DebtItem) => debt.category === 'Mortgage'
    ? mortgageProjectionById.get(debt.id)
    : (plan.allProjections ?? plan.payoffOrder).find(item => item.id === debt.id);
  const visible = scoped.filter(d => d.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) =>
    sort === 0 ? a.name.localeCompare(b.name) : sort === 1 ? b.balance - a.balance : sort === 2 ? b.apr - a.apr :
      ((projectionFor(a)?.monthsToPayoff ?? Infinity) - (projectionFor(b)?.monthsToPayoff ?? Infinity)));
  const selected = debts.find(item => item.id === selectedId) ?? null;
  const accountTransactions = useMemo(() => selected ? transactions
    .filter(tx => tx.accountId === selected.id && tx.deletedAt === null)
    .sort((a, b) => b.date.localeCompare(a.date)) : [], [selected, transactions]);
  const projection = selected ? projectionFor(selected) : undefined;
  const linkedPairs = activeLoanBillLinks(loanBillPairings, recurringBills, debts);
  const selectedLinkedBillId = selected ? linkedPairs[selected.id] : undefined;
  const selectedLinkedBill = selectedLinkedBillId ? recurringBills.find(bill => bill.id === selectedLinkedBillId) : undefined;
  const selectedPairing = selected ? loanBillPairings[selected.id] : undefined;
  const compatibleBills = selected && (selected.category === 'Mortgage' || selected.category === 'Auto loan')
    ? compatibleLoanBills(selected, recurringBills).filter(bill => !Object.entries(linkedPairs).some(([debtId, billId]) => debtId !== selected.id && billId === bill.id))
    : [];
  const selectedCompatibleBillId = compatibleBills.some(bill => bill.id === pairingChoice) ? pairingChoice : (compatibleBills[0]?.id ?? '');
  const saveSelectedPairing = async (relation: LoanBillPairing | null) => {
    if (!selected || !onSaveLoanBillPairings || pairingBusy) return;
    const next = { ...loanBillPairings };
    if (relation) next[selected.id] = relation; else delete next[selected.id];
    setPairingBusy(true); setPairingError('');
    try { await onSaveLoanBillPairings(next); }
    catch (error) { setPairingError(error instanceof Error ? error.message : 'Unable to update the recurring payment link.'); }
    finally { setPairingBusy(false); }
  };

  const startReconcile = () => {
    if (!selected) return;
    setReconcileInput(String(selected.balance));
    setReconcileReason('interest_adjustment');
    setReconcileError('');
    setReconciling(true);
  };
  const saveReconcile = async () => {
    if (!selected || reconcileBusy) return;
    const parsed = parseFloat(reconcileInput);
    if (Number.isNaN(parsed) || parsed < 0) {
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
  const backToAccounts = () => { setSelectedId(null); setReconciling(false); onDismiss?.(); };

  const drift = selected ? (parseFloat(reconcileInput) || 0) - selected.balance : 0;

  return (
    <>
    <FinancialScreen title="Debt" segments={['Accounts', 'Strategy']} selected={view} onSelect={value => setView(value)} onSettings={onSettings} onAdd={view === 'Accounts' ? onAdd : undefined} addLabel="Add debt account">
      {view === 'Accounts' ? <>
      <Segments items={filters} selected={filter} onSelect={value => { setFilter(value); setQuery(''); }} />
      <Card><View style={[ui.row, { justifyContent: 'space-between' }]}><View><Text style={ui.small}>{filter}</Text><Text style={ui.title}>{formatCurrency(stats.balance, currencySymbol)}</Text></View><View style={[ui.badge, ui.row, { gap: 4 }]}><AppIcon name="trendDown" size={14} color="#81DFD2" /><Text style={ui.badgeText}>{`${Math.round(stats.percent)}% snapshot`}</Text></View></View></Card>
      <View style={ui.row}><View style={ui.inputWrap}><AppIcon name="search" size={16} color="#AAB3AD" /><TextInput accessibilityLabel="Search debts" placeholder="Search debts" placeholderTextColor="#AAB3AD" value={query} onChangeText={setQuery} style={{ color: '#F9F9F6', flex: 1, minHeight: 40 }} /></View><SelectDropdown value={sort} options={sortOptions} onSelect={setSort} sheetTitle="Sort debt accounts" style={{ width: 140 }} /></View>
      {!!error && !editor && !selected && <Text accessibilityRole="alert" style={ui.text}>{error}</Text>}
      {visible.length === 0 && <Card><Text style={ui.heading}>No accounts in this category</Text></Card>}
      {visible.map(item => {
        const itemProjection = projectionFor(item);
        const iconName = item.category === 'Mortgage' ? 'homeLoan' : item.category === 'Auto loan' ? 'auto' : 'creditCard';
        return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open ${item.name} account details`} onPress={() => { setSelectedId(item.id); setSection('Overview'); }}>
          <Card>
            <View style={ui.row}><View style={ui.iconCircle}><AppIcon name={iconName} color="#81DFD2" size={20} /></View><View style={{ flex: 1 }}><Text style={ui.heading}>{item.name}</Text><Text style={ui.small}>{`${item.category} · ${item.apr}% APR`}</Text></View><Text style={ui.value}>{formatCurrency(item.balance, currencySymbol)}</Text><AppIcon name="chevronRight" size={16} color="#AAB3AD" /></View>
            <Bar percent={snapshot([item]).percent} /><View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={ui.small}>{`${Math.round(snapshot([item]).percent)}% balance change`}</Text><View style={ui.badge}><Text style={ui.badgeText}>{itemProjection?.projectedPayoffLabel ?? 'No projection'}</Text></View></View>
          </Card>
        </Pressable>;
      })}
      </> : <>
        <Segments items={['Debt strategy', 'Mortgage strategy']} selected={strategyType} onSelect={value => setStrategyType(value as 'Debt strategy' | 'Mortgage strategy')} />
        {strategyType === 'Debt strategy' ? <>
          <Card>
            <Text style={ui.heading}>Extra monthly payment</Text>
            <Text style={ui.small}>Added to the required minimums for the active debt payoff plan.</Text>
            <View style={[ui.row, { gap: 10 }]}>
              <TextInput accessibilityLabel="Extra monthly payment" keyboardType="decimal-pad" value={extraDraft} onChangeText={value => setExtraDraft(prev => acceptMoneyEdit(prev, value, currencyCode))} style={[ui.input, { flex: 1 }]} />
              <Pressable accessibilityRole="button" accessibilityLabel="Save extra monthly payment" disabled={extraBusy || !onExtra} style={[ui.button, extraBusy && { opacity: 0.6 }]} onPress={() => {
                const parsed = validateExtraPaymentInput(extraDraft, currencyCode);
                if (!parsed.valid) { setStrategyError(parsed.error); return; }
                setExtraBusy(true); setStrategyError('');
                void onExtra?.(parsed.extraMonthlyPayment).catch(err => setStrategyError(err instanceof Error ? err.message : 'Unable to save extra payment.')).finally(() => setExtraBusy(false));
              }}><Text style={ui.buttonText}>{extraBusy ? 'Saving…' : 'Save'}</Text></Pressable>
            </View>
            {!!strategyError && <Text accessibilityRole="alert" style={[ui.small, { color: '#FF7A59' }]}>{strategyError}</Text>}
          </Card>
          <Card>
            <Text style={ui.heading}>Choose your payoff strategy</Text>
            <View style={[ui.row, { gap: 12, marginTop: 8 }]}>
              {(['snowball', 'avalanche'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: strategy === value }} disabled={strategyBusy || !onStrategy} onPress={() => {
                if (!onStrategy || strategyBusy) return;
                setStrategyBusy(true); setStrategyError('');
                void onStrategy(value).catch(err => setStrategyError(err instanceof Error ? err.message : 'Unable to save payoff strategy.')).finally(() => setStrategyBusy(false));
              }} style={[ui.segment, { flex: 1, minHeight: 72, padding: 12, gap: 5 }, strategy === value && ui.selected, strategyBusy && { opacity: 0.65 }]}>
                <Text style={[ui.buttonText, { textAlign: 'center' }]}>{value === 'snowball' ? 'Debt Snowball' : 'Debt Avalanche'}</Text>
                <Text style={[ui.small, { textAlign: 'center' }]}>{value === 'snowball' ? 'Smallest balance first' : 'Highest APR first'}</Text>
              </Pressable>)}
            </View>
            <View style={{ marginTop: 12 }}><Text style={ui.small}>Estimated payoff</Text><Text style={ui.heading}>{plan.debtFreeDateLabel}</Text></View>
          </Card>
          <Card>
            <Text style={ui.heading}>Payoff priority</Text>
            <Text style={ui.small}>Projected under the current payment assumptions. This is an estimate, not recorded payment history.</Text>
            {plan.payoffOrder.length ? plan.payoffOrder.map((account, index) => <ProjectionRow key={account.id} account={account} index={index} currencySymbol={currencySymbol} />) : <Text style={ui.small}>Add a debt balance to see the payoff order.</Text>}
          </Card>
        </> : <>
          <Card>
            <Text style={ui.heading}>Mortgage strategy</Text>
            <Text style={ui.small}>Each mortgage is projected on its own. Its extra payment stays with that account and never rolls over to another mortgage. Escrow is excluded from principal and interest.</Text>
          </Card>
          {mortgageDebts.filter(item => item.balance > 0).map(item => {
            const escrow = mortgageEscrowByDebtId[item.id];
            const projection = mortgageProjectionById.get(item.id);
            const draft = mortgageExtraDrafts[item.id] ?? formatEditableMoney(mortgageExtraPaymentByDebtId[item.id] ?? 0, currencyCode);
            return <Card key={item.id}>
              <Text style={ui.heading}>{item.name}</Text>
              <Text style={ui.small}>{escrow === undefined ? 'No escrow amount is entered. Add the known monthly escrow in this account’s editor to show a principal and interest projection.' : `Known escrow excluded: ${formatCurrency(escrow, currencySymbol)} per month.`}</Text>
              <Text style={[ui.small, { marginTop: 8 }]}>Independent extra payment per month</Text>
              <View style={[ui.row, { gap: 10 }]}>
                <TextInput accessibilityLabel={`Extra monthly payment for ${item.name}`} keyboardType="decimal-pad" value={draft} onChangeText={value => setMortgageExtraDrafts(current => ({ ...current, [item.id]: acceptMoneyEdit(current[item.id] ?? formatEditableMoney(mortgageExtraPaymentByDebtId[item.id] ?? 0, currencyCode), value, currencyCode) }))} style={[ui.input, { flex: 1 }]} />
                <Pressable accessibilityRole="button" accessibilityLabel={`Save extra payment for ${item.name}`} disabled={extraBusy || !onMortgageExtra} style={[ui.button, extraBusy && { opacity: 0.6 }]} onPress={() => {
                  const parsed = validateExtraPaymentInput(draft, currencyCode);
                  if (!parsed.valid) { setStrategyError(parsed.error); return; }
                  setExtraBusy(true); setStrategyError('');
                  void onMortgageExtra?.(item.id, parsed.extraMonthlyPayment).catch(error => setStrategyError(error instanceof Error ? error.message : 'Unable to save mortgage extra payment.')).finally(() => setExtraBusy(false));
                }}><Text style={ui.buttonText}>{extraBusy ? 'Saving…' : 'Save'}</Text></Pressable>
              </View>
              {!!strategyError && <Text accessibilityRole="alert" style={[ui.small, { color: '#FF7A59' }]}>{strategyError}</Text>}
              {escrow !== undefined && escrow <= item.minimumPayment && item.minimumPayment - escrow + (mortgageExtraPaymentByDebtId[item.id] ?? 0) <= 0 ? <Text style={ui.small}>Enter a positive known principal and interest payment or extra amount to project this account.</Text> : null}
              {projection ? <ProjectionRow account={projection} index={0} currencySymbol={currencySymbol} /> : null}
            </Card>;
          })}
          {!mortgageDebts.some(item => item.balance > 0) ? <Card><Text style={ui.small}>No active mortgage account has been entered.</Text></Card> : null}
        </>}
      </>}
    </FinancialScreen>
    <SheetModal visible={Boolean(editor)} onClose={onDismiss ?? (() => {})} height="94%">{editor}</SheetModal>
    <Modal visible={!!selected} transparent animationType="slide" onRequestClose={backToAccounts}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close account details" onPress={backToAccounts} style={{ flex: 1 }} />
        {selected && <View accessibilityViewIsModal style={{ height: '88%', backgroundColor: '#1F201F', borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' }}>
          <View style={[ui.row, { justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8 }]}>
            <Text accessibilityRole="header" style={[ui.title, { flex: 1 }]}>{selected.name}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close account details" onPress={backToAccounts} style={ui.button}><Text style={ui.buttonText}>X</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={[ui.screen, { paddingTop: 8, paddingBottom: 36 }]} keyboardShouldPersistTaps="handled">
        <Segments items={detailSections} selected={section} onSelect={value => { setSection(value); setReconciling(false); }} />
        {section === 'Overview' && <>
          <Card>
            <View style={ui.row}>
              <View style={ui.iconCircle}><AppIcon name={selected.category === 'Mortgage' ? 'homeLoan' : selected.category === 'Auto loan' ? 'auto' : 'creditCard'} color="#81DFD2" size={20} /></View>
              <View style={{ flex: 1 }}><Text style={ui.heading}>{selected.name}</Text><Text style={ui.small}>{selected.category}</Text></View>
            </View>
            <Text style={ui.small}>Current balance</Text><Text style={ui.title}>{formatCurrency(selected.balance, currencySymbol)}</Text>
            <View style={[ui.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
              <View><Text style={ui.small}>APR</Text><Text style={ui.heading}>{selected.apr}%</Text></View>
              <View><Text style={ui.small}>Minimum / month</Text><Text style={ui.heading}>{formatCurrency(selected.minimumPayment, currencySymbol)}</Text></View>
              <View><Text style={ui.small}>Due day</Text><Text style={ui.heading}>{selected.dueDay ? `${selected.dueDay}` : '—'}</Text></View>
            </View>
            <View style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
              <View><Text style={ui.small}>Projected payoff</Text><Text style={ui.heading}>{projection?.projectedPayoffLabel ?? 'No active projection'}</Text></View>
              <View><Text style={ui.small}>Balance change</Text><Text style={ui.heading}>{formatCurrency(snapshot([selected]).paid, currencySymbol)}</Text></View>
            </View>
            <Bar percent={snapshot([selected]).percent} />
          </Card>
          <BalanceSparkline selected={selected} anchors={reconciliationAnchors} currencySymbol={currencySymbol} />
        </>}
        {section === 'Transactions' && (() => {
          const now = new Date();
          const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const prevMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

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
            if (tx.category === 'payment' || tx.category === 'refund') {
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

              <View style={[ui.row, { gap: 6, marginVertical: 4 }]}>
                <View style={[ui.card, { flex: 1, padding: 8, backgroundColor: '#262927', borderRadius: 8 }]}>
                  <View style={[ui.row, { gap: 4 }]}>
                    <AppIcon name="trendDown" size={12} color="#81DFD2" />
                    <Text numberOfLines={1} style={ui.small}>Payments</Text>
                  </View>
                  <Text style={[ui.heading, { fontSize: 13 }]}>{formatCurrency(pPayments, currencySymbol)}</Text>
                </View>
                <View style={[ui.card, { flex: 1, padding: 8, backgroundColor: '#262927', borderRadius: 8 }]}>
                  <View style={[ui.row, { gap: 4 }]}>
                    <AppIcon name="brandRise" size={12} color="#E3A088" />
                    <Text numberOfLines={1} style={ui.small}>Interest & fees</Text>
                  </View>
                  <Text style={[ui.heading, { fontSize: 13 }]}>{formatCurrency(pInterestFees, currencySymbol)}</Text>
                </View>
              </View>

              <View style={[ui.row, { gap: 6, marginBottom: 8 }]}>
                <View style={[ui.card, { flex: 1, padding: 8, backgroundColor: '#262927', borderRadius: 8 }]}>
                  <View style={[ui.row, { gap: 4 }]}>
                    <AppIcon name="sort" size={12} color="#AAB3AD" />
                    <Text numberOfLines={1} style={ui.small}>Adjustments</Text>
                  </View>
                  <Text style={[ui.heading, { fontSize: 13 }]}>{formatCurrency(pAdjustments, currencySymbol)}</Text>
                </View>
                <View style={[ui.card, { flex: 1, padding: 8, backgroundColor: '#262927', borderRadius: 8 }]}>
                  <View style={[ui.row, { gap: 4 }]}>
                    <AppIcon name="trendDown" size={12} color={pNetChange < 0 ? '#81DFD2' : pNetChange > 0 ? '#E3A088' : '#AAB3AD'} />
                    <Text numberOfLines={1} style={ui.small}>Net balance</Text>
                  </View>
                  <Text style={[ui.heading, { fontSize: 13, color: pNetChange < 0 ? '#81DFD2' : pNetChange > 0 ? '#E3A088' : '#F9F9F6' }]}>
                    {pNetChange < 0 ? `-${formatCurrency(Math.abs(pNetChange), currencySymbol)}` : pNetChange > 0 ? `+${formatCurrency(pNetChange, currencySymbol)}` : formatCurrency(0, currencySymbol)}
                  </Text>
                </View>
              </View>

              <Card>
                <Text style={ui.heading}>Account activity ({periodTx.length})</Text>
                {periodTx.length === 0 ? (
                  <Text style={ui.text}>No transactions for this account in the selected period.</Text>
                ) : (
                  periodTx.map(tx => {
                    const direction = classifyCategoryDirection(tx.category);
                    const amount = moneyToMajor(tx.amount);
                    const signed = direction === 'decrease_debt' ? `−${formatCurrency(amount, currencySymbol)}` : `+${formatCurrency(amount, currencySymbol)}`;
                    return (
                      <View key={tx.id} style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
                        <View style={{ flex: 1 }}>
                          <View style={[ui.row, { gap: 6, alignItems: 'center' }]}>
                            <Text style={ui.heading}>{tx.payee}</Text>
                            {tx.isPending ? (
                              <View style={[ui.badge, { backgroundColor: '#38321E', borderColor: '#F2C94C', borderWidth: 1, paddingVertical: 1, paddingHorizontal: 5 }]}>
                                <Text style={[ui.badgeText, { color: '#F2C94C', fontSize: 9 }]}>Pending</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={ui.small}>{`${tx.date} · ${tx.category.replace('_', ' ')}`}</Text>
                        </View>
                        <Text style={[ui.value, { color: direction === 'decrease_debt' ? '#81DFD2' : '#E3A088' }]}>{signed}</Text>
                      </View>
                    );
                  })
                )}
              </Card>
            </>
          );
        })()}
        {section === 'Detail' && <>
          <Card>
            <Text style={ui.heading}>Account terms</Text>
            <Term label="Account name" value={selected.name} />
            <Term label="Account type" value={selected.category} />
            <Term label="Current balance" value={formatCurrency(selected.balance, currencySymbol)} />
            <Term label="Starting balance" value={selected.originalBalance === null ? 'Not set' : formatCurrency(selected.originalBalance, currencySymbol)} />
            <Term label="APR" value={`${selected.apr}%`} />
            <Term label="Minimum payment" value={`${formatCurrency(selected.minimumPayment, currencySymbol)} / month`} />
            {selected.category === 'Mortgage' ? <Term label="Monthly escrow" value={mortgageEscrowByDebtId[selected.id] === undefined ? 'Not entered' : `${formatCurrency(mortgageEscrowByDebtId[selected.id], currencySymbol)} / month`} /> : null}
            <Term label="Due day" value={selected.dueDay ? `Day ${selected.dueDay}` : 'Not set'} />
            <Term label="Credit limit" value={selected.creditLimit === null ? 'Not set' : formatCurrency(selected.creditLimit, currencySymbol)} />
            <Pressable accessibilityRole="button" onPress={() => { setSelectedId(null); onEdit(selected); }} style={ui.button}><Text style={ui.buttonText}>Edit account</Text></Pressable>
          </Card>
          {(selected.category === 'Mortgage' || selected.category === 'Auto loan') ? <Card>
            <Text style={ui.heading}>Recurring payment link</Text>
            {selectedLinkedBill ? <>
              <Text style={ui.text}>{`${selectedLinkedBill.name} · ${formatCurrency(moneyToMajor(selectedLinkedBill.amount), currencySymbol)} / month · due day ${selectedLinkedBill.dueDay}`}</Text>
              <Text style={ui.small}>{selected.category === 'Auto loan'
                ? 'This linked item replaces the auto loan minimum in the Budget commitment total. The debt balance and payoff projection are unchanged.'
                : 'This recurring item is a Budget commitment. Mortgage principal, escrow, and balance are not inferred from it.'}</Text>
              <Pressable accessibilityRole="button" disabled={pairingBusy} onPress={() => void saveSelectedPairing(null)} style={ui.button}><Text style={ui.buttonText}>Unlink recurring payment</Text></Pressable>
            </> : <>
              {selectedPairing?.status === 'linked' ? <>
                <Text style={ui.small}>Saved link to {selectedPairing.billId}, but that item is unavailable or incompatible. It is not applied to Budget totals or reminders.</Text>
                <Pressable accessibilityRole="button" disabled={pairingBusy} onPress={() => void saveSelectedPairing(null)} style={ui.button}><Text style={ui.buttonText}>Remove saved link</Text></Pressable>
              </> : null}
              {loanBillPairings[selected.id]?.status === 'separate' ? <Text style={ui.small}>This loan is marked as a separate Budget commitment.</Text> : null}
              {loanBillPairings[selected.id]?.status === 'dismissed' ? <Text style={ui.small}>Loan payment link review was dismissed.</Text> : null}
              {compatibleBills.length ? <>
                <SelectDropdown label="Recurring payment" sheetTitle="Choose recurring payment"
                  value={selectedCompatibleBillId} options={compatibleBills.map(bill => ({ value: bill.id, label: bill.name }))}
                  onSelect={setPairingChoice} />
                <Pressable accessibilityRole="button" disabled={pairingBusy || !selectedCompatibleBillId} onPress={() => void saveSelectedPairing({ status: 'linked', billId: selectedCompatibleBillId })} style={ui.button}><Text style={ui.buttonText}>Link recurring payment</Text></Pressable>
              </> : <Text style={ui.small}>Add an eligible debit recurring item in Budget before linking it here.</Text>}
            </>}
            {!!pairingError && <Text accessibilityRole="alert" style={[ui.small, { color: '#E3A088' }]}>{pairingError}</Text>}
          </Card> : null}
          <Card>
            <Text style={ui.heading}>Reconcile statement balance</Text>
            {!reconciling ? <Pressable accessibilityRole="button" onPress={startReconcile} style={ui.button}><Text style={ui.buttonText}>Reconcile balance</Text></Pressable> : <>
              {!!reconcileError && <Text accessibilityRole="alert" style={[ui.small, { color: '#E3A088', marginVertical: 6 }]}>{reconcileError}</Text>}
              <Text style={ui.small}>{`Current balance ${formatCurrency(selected.balance, currencySymbol)}`}</Text>
              <TextInput accessibilityLabel="Statement balance" placeholder="0.00" placeholderTextColor="#AAB3AD" keyboardType="decimal-pad" value={reconcileInput} onChangeText={value => setReconcileInput(acceptMoneyEdit(reconcileInput, value, currencyCode))} style={ui.input} />
              <Text style={ui.small}>{`Difference: ${formatCurrency(drift, currencySymbol)}`}</Text>
              {drift !== 0 && <View style={{ gap: 8 }}>
                {(drift > 0 ? ['interest_adjustment', 'balance_adjustment'] as const : ['credit_adjustment'] as const).map(reason => <Pressable key={reason} onPress={() => setReconcileReason(reason)} style={ui.row}>
                  <Text style={[ui.buttonText, { color: reconcileReason === reason ? '#81DFD2' : '#AAB3AD' }]}>{reconcileReason === reason ? '◉' : '○'} {reason.replace('_', ' ')}</Text>
                </Pressable>)}
              </View>}
              <View style={ui.row}>
                <Pressable onPress={() => setReconciling(false)} disabled={reconcileBusy} style={[ui.button, { flex: 1 }]}>
                  <Text style={ui.buttonText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={() => void saveReconcile()} disabled={reconcileBusy} style={[ui.button, { flex: 1, backgroundColor: '#31534D' }]}>
                  <Text style={ui.buttonText}>{reconcileBusy ? 'Saving\u2026' : 'Save balance'}</Text>
                </Pressable>
              </View>
            </>}
          </Card>
          <Pressable accessibilityRole="button" onPress={() => onRemove(selected)} style={[ui.button, { borderWidth: 1, borderColor: '#8B4F42' }]}><Text style={[ui.buttonText, { color: '#E3A088' }]}>Delete account</Text></Pressable>
        </>}
        {!!error && <Text accessibilityRole="alert" style={ui.text}>{error}</Text>}
          </ScrollView>
        </View>}
      </View>
    </Modal>
    </>
  );
}

function ProjectionRow({ account, index, currencySymbol }: { account: PayoffPlanResult['payoffOrder'][number]; index: number; currencySymbol: string }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={ui.divider}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${index + 1}. ${account.name}, ${account.projectedPayoffLabel}`} onPress={() => setExpanded(!expanded)} style={[ui.row, { justifyContent: 'space-between', gap: 10 }]}>
      <View style={{ flex: 1 }}><Text style={ui.heading}>{index + 1}. {account.name}</Text><Text style={ui.small}>{`${account.apr}% APR · ${formatCurrency(account.balance, currencySymbol)} balance`}</Text></View>
      <View style={{ alignItems: 'flex-end' }}><Text style={ui.value}>{account.projectedPayoffLabel}</Text><Text style={ui.small}>{expanded ? 'Hide schedule' : 'View schedule'}</Text></View>
    </Pressable>
    {expanded ? <ScrollView style={{ maxHeight: 280, marginTop: 10 }} nestedScrollEnabled>
      <View style={[ui.row, { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#353A37' }]}>{['Month', 'Payment', 'Interest', 'Balance'].map(label => <Text key={label} style={[ui.small, { flex: 1, fontWeight: '700' }]}>{label}</Text>)}</View>
      {account.monthlySchedule.map((row, rowIndex) => <View key={`${account.id}-${rowIndex}`} style={[ui.row, { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#353A37' }]}><Text style={[ui.text, { flex: 1 }]}>{row.month}</Text><Text style={[ui.text, { flex: 1 }]}>{formatCurrency(row.payment, currencySymbol)}</Text><Text style={[ui.text, { flex: 1 }]}>{formatCurrency(row.interest, currencySymbol)}</Text><Text style={[ui.text, { flex: 1 }]}>{formatCurrency(row.balance, currencySymbol)}</Text></View>)}
      {!account.monthlySchedule.length ? <Text style={ui.small}>Projection unavailable.</Text> : null}
    </ScrollView> : null}
  </View>;
}

function Term({ label, value }: { label: string; value: string }) {
  return <View style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}><Text style={ui.small}>{label}</Text><Text style={[ui.heading, { fontSize: 14, textAlign: 'right', flex: 1 }]}>{value}</Text></View>;
}
