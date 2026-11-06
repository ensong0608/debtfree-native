import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, BackHandler, Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop, Circle } from 'react-native-svg';
import { Bar, Card, categoryDebts, FinancialScreen, Segments, snapshot, ui } from '../components/FinancialScreen';
import { AppIcon } from '../components/AppIcon';
import { formatCurrency, acceptMoneyEdit, type DebtItem, type PayoffPlanResult } from '../onboarding-domain';
import { type LedgerTransaction, type ReconciliationAnchor, classifyCategoryDirection } from '../finance/ledger';
import { moneyToMajor } from '../finance/money';

const filters = ['Cards & Loans', 'Home & Auto', 'All Debts'] as const;
const sorts = ['Name', 'Balance', 'APR', 'Payoff'] as const;
const detailSections = ['Overview', 'Transactions', 'Manage / Terms'] as const;
const txPeriods = ['Current month', 'Previous month', 'Lifetime'] as const;

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
  onAdd, onEdit, onRemove, onReconcile, onSettings, initialSelectedId,
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
}) {
  const [filter, setFilter] = useState<string>(filters[0]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [section, setSection] = useState<string>(detailSections[0]);
  const [txPeriod, setTxPeriod] = useState<string>(txPeriods[0]);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileInput, setReconcileInput] = useState('');
  const [reconcileReason, setReconcileReason] = useState<'interest_adjustment' | 'balance_adjustment' | 'credit_adjustment'>('interest_adjustment');
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileError, setReconcileError] = useState('');

  const [prevInitialId, setPrevInitialId] = useState(initialSelectedId);
  if (initialSelectedId !== prevInitialId) {
    setPrevInitialId(initialSelectedId);
    if (initialSelectedId !== undefined && initialSelectedId !== null) {
      setSelectedId(initialSelectedId);
      setSection('Overview');
    }
  }

  useEffect(() => {
    if (!selectedId) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedId(null);
      setReconciling(false);
      return true;
    });
    return () => sub.remove();
  }, [selectedId]);

  const scoped = categoryDebts(debts, filter);
  const stats = snapshot(scoped);
  const visible = scoped.filter(d => d.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) =>
    sort === 0 ? a.name.localeCompare(b.name) : sort === 1 ? b.balance - a.balance : sort === 2 ? b.apr - a.apr :
      (((plan.allProjections ?? plan.payoffOrder).find(p => p.id === a.id)?.monthsToPayoff ?? Infinity) -
       ((plan.allProjections ?? plan.payoffOrder).find(p => p.id === b.id)?.monthsToPayoff ?? Infinity)));
  const selected = debts.find(item => item.id === selectedId) ?? null;
  const accountTransactions = useMemo(() => selected ? transactions
    .filter(tx => tx.accountId === selected.id && tx.deletedAt === null)
    .sort((a, b) => b.date.localeCompare(a.date)) : [], [selected, transactions]);
  const projection = selected ? (plan.allProjections ?? plan.payoffOrder).find(p => p.id === selected.id) : undefined;

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
  const backToAccounts = () => { setSelectedId(null); setReconciling(false); };

  if (selected) {
    const drift = (parseFloat(reconcileInput) || 0) - selected.balance;
    const iconName = selected.category === 'Mortgage' ? 'homeLoan' : selected.category === 'Auto loan' ? 'auto' : 'creditCard';
    return (
      <FinancialScreen title={selected.name} onSettings={onSettings}>
        <Pressable accessibilityRole="button" onPress={backToAccounts} style={[ui.button, ui.row, { alignSelf: 'flex-start' }]}>
          <AppIcon name="chevronLeft" size={14} color="#81DFD2" /><Text style={ui.buttonText}>Back to Accounts</Text>
        </Pressable>
        <Segments items={detailSections} selected={section} onSelect={value => { setSection(value); setReconciling(false); }} />
        {editor}
        {section === 'Overview' && <>
          <Card>
            <View style={ui.row}>
              <View style={ui.iconCircle}><AppIcon name={iconName} color="#81DFD2" size={20} /></View>
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
              <Segments
                items={txPeriods}
                selected={txPeriod}
                onSelect={setTxPeriod}
              />

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
        {section === 'Manage / Terms' && <>
          <Card>
            <Text style={ui.heading}>Account terms</Text>
            <Term label="Account name" value={selected.name} />
            <Term label="Account type" value={selected.category} />
            <Term label="Current balance" value={formatCurrency(selected.balance, currencySymbol)} />
            <Term label="Starting balance" value={selected.originalBalance === null ? 'Not set' : formatCurrency(selected.originalBalance, currencySymbol)} />
            <Term label="APR" value={`${selected.apr}%`} />
            <Term label="Minimum payment" value={`${formatCurrency(selected.minimumPayment, currencySymbol)} / month`} />
            <Term label="Due day" value={selected.dueDay ? `Day ${selected.dueDay}` : 'Not set'} />
            <Term label="Credit limit" value={selected.creditLimit === null ? 'Not set' : formatCurrency(selected.creditLimit, currencySymbol)} />
            <Pressable accessibilityRole="button" onPress={() => onEdit(selected)} style={ui.button}><Text style={ui.buttonText}>Edit account</Text></Pressable>
          </Card>
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
      </FinancialScreen>
    );
  }

  return (
    <FinancialScreen title="Debt" segments={filters} selected={filter} onSelect={value => { setFilter(value); setQuery(''); }} onSettings={onSettings} onAdd={onAdd} addLabel="Add debt account">
      <Card><View style={[ui.row, { justifyContent: 'space-between' }]}><View><Text style={ui.small}>{filter}</Text><Text style={ui.title}>{formatCurrency(stats.balance, currencySymbol)}</Text></View><View style={[ui.badge, ui.row, { gap: 4 }]}><AppIcon name="trendDown" size={14} color="#81DFD2" /><Text style={ui.badgeText}>{`${Math.round(stats.percent)}% snapshot`}</Text></View></View></Card>
      <View style={ui.row}><View style={ui.inputWrap}><AppIcon name="search" size={16} color="#AAB3AD" /><TextInput accessibilityLabel="Search debts" placeholder="Search debts" placeholderTextColor="#AAB3AD" value={query} onChangeText={setQuery} style={{ color: '#F9F9F6', flex: 1, minHeight: 40 }} /></View><Pressable accessibilityRole="button" accessibilityLabel={`Sort debts by ${sorts[sort]}; change sort`} onPress={() => setSort((sort + 1) % sorts.length)} style={[ui.button, ui.row, { gap: 6 }]}><AppIcon name="sort" size={15} color="#81DFD2" /><Text style={ui.buttonText}>{sorts[sort]}</Text><AppIcon name="chevronDown" size={13} color="#81DFD2" /></Pressable></View>
      {editor}{!!error && !editor && <Text accessibilityRole="alert" style={ui.text}>{error}</Text>}
      {visible.length === 0 && <Card><Text style={ui.heading}>No accounts in this category</Text></Card>}
      {visible.map(item => {
        const itemProjection = (plan.allProjections ?? plan.payoffOrder).find(p => p.id === item.id);
        const iconName = item.category === 'Mortgage' ? 'homeLoan' : item.category === 'Auto loan' ? 'auto' : 'creditCard';
        return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open ${item.name} account details`} onPress={() => { setSelectedId(item.id); setSection('Overview'); }}>
          <Card>
            <View style={ui.row}><View style={ui.iconCircle}><AppIcon name={iconName} color="#81DFD2" size={20} /></View><View style={{ flex: 1 }}><Text style={ui.heading}>{item.name}</Text><Text style={ui.small}>{`${item.category} · ${item.apr}% APR`}</Text></View><Text style={ui.value}>{formatCurrency(item.balance, currencySymbol)}</Text><AppIcon name="chevronRight" size={16} color="#AAB3AD" /></View>
            <Bar percent={snapshot([item]).percent} /><View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={ui.small}>{`${Math.round(snapshot([item]).percent)}% balance change`}</Text><View style={ui.badge}><Text style={ui.badgeText}>{itemProjection?.projectedPayoffLabel ?? 'No projection'}</Text></View></View>
          </Card>
        </Pressable>;
      })}
    </FinancialScreen>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return <View style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}><Text style={ui.small}>{label}</Text><Text style={[ui.heading, { fontSize: 14, textAlign: 'right', flex: 1 }]}>{value}</Text></View>;
}
