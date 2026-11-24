import { memo, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, type DimensionValue } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { AmountText } from '../components/AmountText';
import { AccountMark } from '../components/AccountMark';
import { AppIcon } from '../components/AppIcon';
import { Bar, Card, FinancialScreen, ui } from '../components/FinancialScreen';
import { InformationButton as InfoButton } from '../components/InformationSheet';
import { InspireCornerArt } from '../components/InspireArt';
import { PeriodDateSheet } from '../components/PeriodDateSheet';
import { Pressable, Text, View, appearanceColor, useNativeAppearance } from '../components/NativeAppearance';
import { currentHouseholdDate, getPreviousMonthString } from '../finance/calendar';
import { calculateTransactionBalanceDelta, isPaidOffAccountArchived, type LedgerTransaction } from '../finance/ledger';
import { makeMoney, moneyToMajor } from '../finance/money';
import { calculateAccountActivities, calculateActivitySummary, calculateCreditUtilization, calculateMilestones, calculateUtilizationAdvisor, filterTransactionsByPeriod, type ProgressPeriod } from '../finance/progress';
import { formatCurrency, type DebtItem, type PayoffStrategy } from '../onboarding-domain';
import { DEFAULT_TAB_UI_PREFERENCES, useProgressUiPreferences, useSetTabUiPreferences, type TabUiPreferences } from '../components/TabShellContext';

const longMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonth = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
function polarPoint(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy - radius * Math.sin(rad),
  };
}

function describeArc(cx: number, cy: number, radius: number, startAngleDeg: number, endAngleDeg: number) {
  const start = polarPoint(cx, cy, radius, startAngleDeg);
  const end = polarPoint(cx, cy, radius, endAngleDeg);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function ProgressSpeedometer({ percent }: { percent: number }) {
  const { isInspire, palette } = useNativeAppearance();
  const { width } = useWindowDimensions();
  const gaugeWidth = Math.min(160, Math.round(width * 0.38));
  const clamped = Math.max(0, Math.min(200, percent));
  const needleAngle = 180 - (clamped / 200) * 179.99;
  const cx = 74;
  const cy = 70;
  const radius = 54;
  const tip = polarPoint(cx, cy, 44, needleAngle);
  const left = polarPoint(cx, cy, 4, needleAngle + 90);
  const right = polarPoint(cx, cy, 4, needleAngle - 90);

  return (
    <View style={{ width: gaugeWidth, alignItems: 'center', flexShrink: 0 }}>
      <Svg width={gaugeWidth} height={Math.round(gaugeWidth * 0.54)} viewBox="0 0 148 80" accessible={false}>
        <Defs>
          <LinearGradient id="progressGauge" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={148} y2={0}>
            <Stop offset="0%" stopColor="#E99409" />
            <Stop offset="50%" stopColor="#83E75D" />
            <Stop offset="100%" stopColor="#28BA63" />
          </LinearGradient>
        </Defs>
        {isInspire ? <Path d={describeArc(cx, cy, radius, 180, 0)} fill="none" stroke={palette.graphOutline} strokeWidth={14} strokeLinecap="round" /> : null}
        <Path d={describeArc(cx, cy, radius, 180, 0)} fill="none" stroke={palette.raised} strokeWidth={12} strokeLinecap="round" />
        {isInspire && clamped > 0 ? <Path d={describeArc(cx, cy, radius, 180, needleAngle)} fill="none" stroke={palette.graphOutline} strokeWidth={14} strokeLinecap="round" /> : null}
        {clamped > 0 ? <Path d={describeArc(cx, cy, radius, 180, needleAngle)} fill="none" stroke="url(#progressGauge)" strokeWidth={12} strokeLinecap="round" /> : null}
        <Line x1={cx} y1={cy - radius - 7} x2={cx} y2={cy - radius + 7} stroke={palette.text} strokeOpacity={0.4} strokeWidth={1.5} strokeDasharray="2 2" />
        <Path d={`M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y} Z`} fill={palette.text} stroke={isInspire ? palette.graphOutline : 'none'} />
        <Circle cx={cx} cy={cy} r={6} fill={palette.text} />
        <Circle cx={cx} cy={cy} r={2.3} fill={palette.surface} />
      </Svg>
      <View style={[ui.row, { width: '100%', justifyContent: 'space-between', alignItems: 'baseline', marginTop: -3 }]}>
        <Text style={[ui.small, { fontSize: 11, fontWeight: '700' }]}>0%</Text>
        <Text style={[ui.title, { color: percent >= 100 ? palette.posInk : palette.text, fontSize: 21, fontWeight: '800' }]}>{`${Math.round(percent)}%`}</Text>
        <Text style={[ui.small, { fontSize: 11, fontWeight: '700' }]}>200%+</Text>
      </View>
    </View>
  );
}

function utilizationBadgeColors(statusBand: string, isLight: boolean, mutedColor: string, raisedColor: string, borderColor: string) {
  if (statusBand === 'optimal' || statusBand === 'good') {
    return {
      color: isLight ? '#087D42' : '#98EDC1',
      solidBg: isLight ? '#087D42' : '#157A4B',
      bg: isLight ? 'rgba(8, 125, 66, 0.10)' : 'rgba(152, 237, 193, 0.14)',
      border: isLight ? 'rgba(8, 125, 66, 0.25)' : 'rgba(152, 237, 193, 0.28)',
      barColor: isLight ? '#087D42' : '#76DCB9',
      label: 'Good',
    };
  }
  if (statusBand === 'moderate') {
    return {
      color: isLight ? '#91670A' : '#F59E0B',
      solidBg: isLight ? '#91670A' : '#B4690E',
      bg: isLight ? 'rgba(217, 119, 6, 0.10)' : 'rgba(245, 158, 11, 0.14)',
      border: isLight ? 'rgba(217, 119, 6, 0.28)' : 'rgba(245, 158, 11, 0.30)',
      barColor: isLight ? '#91670A' : '#F59E0B',
      label: 'Watch',
    };
  }
  if (statusBand === 'high') {
    return {
      color: isLight ? '#A82443' : '#F08B78',
      solidBg: isLight ? '#A82443' : '#B91C3C',
      bg: isLight ? 'rgba(220, 38, 38, 0.10)' : 'rgba(240, 139, 120, 0.14)',
      border: isLight ? 'rgba(220, 38, 38, 0.25)' : 'rgba(240, 139, 120, 0.30)',
      barColor: isLight ? '#A82443' : '#F08B78',
      label: 'High',
    };
  }
  return {
    color: mutedColor,
    solidBg: raisedColor,
    bg: raisedColor,
    border: borderColor,
    barColor: mutedColor,
    label: 'Unavailable',
  };
}

function AwardSeal({ earned, size = 68 }: { earned: boolean; size?: number }) {
  const { isLight, palette } = useNativeAppearance();
  const ink = appearanceColor(earned ? '#76DCB9' : '#728078', isLight);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false}>
      <Defs>
        <RadialGradient id="award-surface" cx="35%" cy="25%" r="80%">
          <Stop offset="0" stopColor={palette.tint} />
          <Stop offset="1" stopColor={palette.surface} />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="47" fill="url(#award-surface)" stroke={ink} strokeWidth="1" />
      <Circle cx="50" cy="50" r="40" fill="none" stroke={ink} strokeWidth="0.5" opacity={0.5} />
      <Path
        d="M37 27h26v20a13 13 0 0 1-26 0V27ZM37 32H26v8a13 13 0 0 0 12 13M63 32h11v8a13 13 0 0 1-12 13M50 60v15M37 77h26"
        fill="none"
        stroke={ink}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export const ProgressScreen = memo(function ProgressScreen({
  debts,
  transactions = [],
  currencySymbol = '$',
  currencyCode = 'USD',
  plannedMonthlyPayment,
  archivedPaidOffDebtIds = [],
  householdTimeZone,
  onSettings,
  onSelectDebt,
  onOpenStrategy,
  onSimulateExtra,
}: {
  debts: DebtItem[];
  transactions?: LedgerTransaction[];
  currencySymbol?: string;
  currencyCode?: string;
  plannedMonthlyPayment?: number;
  archivedPaidOffDebtIds?: readonly string[];
  strategy?: PayoffStrategy;
  householdTimeZone?: string;
  onSettings: () => void;
  onSelectDebt?: (debtId: string) => void;
  onOpenStrategy?: () => void;
  onSimulateExtra?: (amount: number) => void;
}) {
  const progressUi = useProgressUiPreferences();
  const shellSetUiPreferences = useSetTabUiPreferences();
  const [localUiPreferences, setLocalUiPreferences] = useState<TabUiPreferences>(DEFAULT_TAB_UI_PREFERENCES);
  const uiPreferences = progressUi ?? localUiPreferences;
  const setUiPreferences = shellSetUiPreferences ?? setLocalUiPreferences;
  const tab = uiPreferences.progressSection;
  const setTab = (value: 'Overview' | 'Utilization' | 'Milestones') => setUiPreferences(current => ({ ...current, progressSection: value }));
  const [period, setPeriod] = useState<ProgressPeriod>('current_month');
  const [showDate, setShowDate] = useState(false);
  const { isLight, isInspire, palette } = useNativeAppearance();

  const today = currentHouseholdDate(householdTimeZone);
  const currentMonth = today.slice(0, 7) as `${number}-${number}`;
  const currentYear = Number(today.slice(0, 4));
  const selectedPeriod = period === 'current_month' ? currentMonth
    : period === 'previous_month' ? getPreviousMonthString(currentMonth) as `${number}-${number}`
    : period;
  const lifetime = selectedPeriod === 'lifetime';
  const selectedDate = selectedPeriod.length === 7 ? new Date(`${selectedPeriod}-01T12:00:00Z`) : null;
  const dateLabel = lifetime ? 'Lifetime' : selectedDate ? longMonth.format(selectedDate) : selectedPeriod;
  const periodTag = selectedDate ? shortMonth.format(selectedDate).toLocaleUpperCase() : dateLabel.toLocaleUpperCase();
  const earliestYear = useMemo(
    () => transactions.reduce((earliest, tx) => {
      const year = Number(tx.date.slice(0, 4));
      return tx.deletedAt === null && year >= 1970 ? Math.min(earliest, year) : earliest;
    }, currentYear),
    [transactions, currentYear],
  );

  const {
    overviewDebts,
    overviewDebtById,
    activeProgressDebts,
    overviewTransactions,
    hasPending,
  } = useMemo(() => {
    const overviewDebts = debts.filter(debt => debt.category === 'Credit card' || debt.category === 'Personal loan');
    const overviewDebtById = new Map(overviewDebts.map(debt => [debt.id, debt]));
    const activeProgressDebts = overviewDebts.filter(debt => !isPaidOffAccountArchived(debt, archivedPaidOffDebtIds));
    const overviewTransactions = transactions.filter(
      tx => tx.accountId !== null && overviewDebtById.has(tx.accountId),
    );
    const hasPending = overviewTransactions.some(tx => tx.isPending && tx.deletedAt === null);
    return { overviewDebts, overviewDebtById, activeProgressDebts, overviewTransactions, hasPending };
  }, [debts, archivedPaidOffDebtIds, transactions]);

  const summary = useMemo(
    () => calculateActivitySummary({
      transactions: overviewTransactions,
      debts: overviewDebts,
      period: selectedPeriod,
      today,
      currencyCode,
    }),
    [overviewTransactions, overviewDebts, selectedPeriod, today, currencyCode],
  );
  const movementTotal = useMemo(() => {
    let totalMinor = 0;
    for (const tx of filterTransactionsByPeriod(overviewTransactions, selectedPeriod, today)) {
      const debt = tx.accountId === null ? undefined : overviewDebtById.get(tx.accountId);
      if (!debt || tx.isPending || tx.amount.currency !== currencyCode) continue;
      totalMinor += calculateTransactionBalanceDelta(tx, debt.category).minorUnits;
    }
    return moneyToMajor(makeMoney(currencyCode, totalMinor));
  }, [overviewTransactions, overviewDebtById, selectedPeriod, today, currencyCode]);
  const accountActivities = useMemo(
    () => calculateAccountActivities({
      transactions: overviewTransactions,
      debts: activeProgressDebts,
      period: selectedPeriod,
      today,
      currencyCode,
    }),
    [overviewTransactions, activeProgressDebts, selectedPeriod, today, currencyCode],
  );
  const {
    paidOffDebts,
    utilization,
    milestones,
  } = useMemo(() => {
    const paidOffDebts = debts.filter(debt => isPaidOffAccountArchived(debt, archivedPaidOffDebtIds));
    const archivedUtilizationDebtIds = paidOffDebts.map(debt => debt.id);
    const utilization = calculateCreditUtilization(activeProgressDebts, currencyCode);
    const milestones = calculateMilestones({
      debts,
      transactions,
      currencyCode,
      excludedUtilizationDebtIds: archivedUtilizationDebtIds,
      archivedPaidOffDebtIds,
    });
    return { paidOffDebts, utilization, milestones };
  }, [debts, archivedPaidOffDebtIds, activeProgressDebts, transactions, currencyCode]);

  const fallbackPlanned = activeProgressDebts
    .filter(d => d.balance > 0)
    .reduce((sum, d) => sum + Math.max(0, d.minimumPayment), 0);
  const monthsInPeriod = lifetime ? 0 : selectedDate ? 1
    : Number(selectedPeriod) === currentYear ? Number(currentMonth.slice(5)) : 12;
  const plannedForPeriod = monthsInPeriod * Math.max(0, plannedMonthlyPayment ?? fallbackPlanned);

  const planPaymentsForTarget = summary.totalPayments;
  const gaugePercent =
    lifetime
      ? summary.totalPayments > 0
        ? 100
        : 0
      : plannedForPeriod > 0
      ? Math.round((planPaymentsForTarget / plannedForPeriod) * 100)
      : planPaymentsForTarget > 0
      ? 100
      : 0;

  const planDelta = planPaymentsForTarget - plannedForPeriod;
  const isAhead = plannedForPeriod > 0 && planDelta >= 0;
  const isBehind = plannedForPeriod > 0 && planDelta < 0;

  const statusMeta =
    lifetime
      ? {
          title: 'Lifetime total',
          subtitle: `${summary.transactionsCount} confirmed ${summary.transactionsCount === 1 ? 'entry' : 'entries'}`,
          pill: `${formatCurrency(summary.totalPayments, currencySymbol)} paid`,
          bannerBg: isLight ? '#EDF7F1' : 'rgba(118, 220, 185, 0.12)',
          pillBg: isLight ? '#DCF0E5' : 'rgba(118, 220, 185, 0.2)',
          accent: isLight ? '#087D42' : '#76DCB9',
        }
      : isAhead && gaugePercent >= 120
      ? {
          title: 'Excellent!',
          subtitle: `${formatCurrency(planDelta, currencySymbol)} above your plan`,
          pill: `${gaugePercent - 100}% above target`,
          bannerBg: isLight ? '#EDF7F1' : 'rgba(118, 220, 185, 0.12)',
          pillBg: isLight ? '#DCF0E5' : 'rgba(118, 220, 185, 0.2)',
          accent: isLight ? '#087D42' : '#76DCB9',
        }
      : isAhead
      ? {
          title: 'On target!',
          subtitle:
            planDelta > 0
              ? `${formatCurrency(planDelta, currencySymbol)} above your plan`
              : 'Monthly target met',
          pill: `${gaugePercent}% of target`,
          bannerBg: isLight ? '#EDF7F1' : 'rgba(118, 220, 185, 0.12)',
          pillBg: isLight ? '#DCF0E5' : 'rgba(118, 220, 185, 0.2)',
          accent: isLight ? '#087D42' : '#76DCB9',
        }
      : isBehind && gaugePercent >= 60
      ? {
          title: 'In progress',
          subtitle: `${formatCurrency(Math.abs(planDelta), currencySymbol)} left to reach plan`,
          pill: `${gaugePercent}% of target`,
          bannerBg: isLight ? '#EBF3FA' : 'rgba(96, 165, 250, 0.12)',
          pillBg: isLight ? '#DCEAF7' : 'rgba(96, 165, 250, 0.2)',
          accent: palette.brand,
        }
      : {
          title: 'Getting started',
          subtitle:
            plannedForPeriod > 0
              ? `${formatCurrency(Math.abs(planDelta), currencySymbol)} left to reach plan`
              : 'Record payments to track progress',
          pill: plannedForPeriod > 0 ? `${gaugePercent}% of target` : 'No payment target',
          bannerBg: isLight ? '#FFF8E8' : 'rgba(245, 197, 99, 0.12)',
          pillBg: isLight ? '#FBECC8' : 'rgba(245, 197, 99, 0.2)',
          accent: appearanceColor('#F5C563', isLight),
        };

  const currentGoal = milestones.find(item => item.id === 'credit_util_30');
  const recorded = milestones.filter(item => item.id !== 'credit_util_30' && item.status !== 'locked');
  const earnedCount = recorded.filter(item => item.status === 'completed').length;
  const inProgressCount = milestones.filter(item => item.status === 'in_progress').length;
  const lockedHistory = milestones.filter(item => item.id !== 'credit_util_30' && item.status === 'locked');
  const lockedCount = milestones.filter(item => item.status === 'locked').length;
  const nextUnlock = milestones.find(item => item.status === 'in_progress');
  const titleFor = (item: typeof milestones[number]) =>
    item.id === 'first_1000' ? 'First ' + formatCurrency(item.targetValue, currencySymbol) + ' paydown' : item.title;

  const creditCards = activeProgressDebts.filter(debt => debt.category === 'Credit card');
  const advisor = calculateUtilizationAdvisor(creditCards, currencyCode);
  const utilTargetCap = utilization.totalLimit * 0.3;
  const toReach30 = Math.max(0, utilization.totalUsed - utilTargetCap);
  const overallUtilStatus =
    utilization.statusBand === 'optimal' || utilization.statusBand === 'good'
      ? 'Healthy'
      : utilization.statusBand === 'moderate'
      ? 'Watch'
      : utilization.statusBand === 'high'
      ? 'High'
      : 'Unavailable';
  const usedArcColor = utilizationBadgeColors(utilization.statusBand, isLight, palette.muted, palette.raised, palette.border).barColor;
  const availTrackColor = palette.raised;
  const donutCircumference = 2 * Math.PI * 55;
  const donutPercent = Math.max(0, Math.min(100, utilization.utilizationPercent));

  const pendingNotice = hasPending ? (
    <View style={ui.row}>
      <Text style={[ui.small, { color: appearanceColor('#F5C563', isLight), flex: 1 }]}>
        Balances provisional - payments pending
      </Text>
      <InfoButton
        label="Pending changes"
        detail="Displayed balances are provisional while debt changes await confirmation. Unconfirmed payments are excluded from recorded activity and payment milestones."
      />
    </View>
  ) : null;

  return (
    <>
    <FinancialScreen
      title="Progress"
      segments={['Overview', 'Utilization', 'Milestones']}
      selected={tab}
      onSelect={value => setTab(value === 'Utilization' || value === 'Milestones' ? value : 'Overview')}
      onSettings={onSettings}
      renderSegment={segment => (
        <>
          {pendingNotice}
          {segment === 'Overview' ? (
        <View style={{ gap: 12 }}>
          <Card style={{ padding: 14, borderRadius: 20, gap: 10 }}>
            <InspireCornerArt kind="hero-overview" borderRadius={20} />
            <View style={[ui.row, { justifyContent: 'space-between', gap: 8 }]}>
              <Text accessibilityRole="header" style={{ color: palette.text, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 }}>{periodTag}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Date, ${dateLabel}`} accessibilityState={{ expanded: showDate }} onPress={() => setShowDate(true)}
                hitSlop={5} style={[ui.row, { minHeight: 34, borderRadius: 22, paddingHorizontal: 12, gap: 8, backgroundColor: palette.raised, borderColor: palette.cardBorder, borderWidth: isInspire ? 1.5 : 1 }]}>
                <Text style={[ui.small, { color: palette.text, fontWeight: '700' }]}>{dateLabel}</Text>
                <AppIcon name="chevronDown" size={12} color={palette.text} />
              </Pressable>
            </View>
            <View style={{
                paddingVertical: 6,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                <Text style={[ui.title, { fontSize: 26, fontWeight: '800', letterSpacing: -0.45 }]}>{statusMeta.title}</Text>
                <Text style={{ color: palette.text, fontSize: 14, fontWeight: '600' }}>
                  {isAhead && planDelta > 0 ? <><Text style={{ color: palette.posInk }}>{formatCurrency(planDelta, currencySymbol)}</Text> above your plan</> : statusMeta.subtitle}
                </Text>
                <View
                  style={{
                    alignSelf: 'flex-start',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 999,
                    backgroundColor: isInspire ? palette.selection : statusMeta.pillBg,
                    borderWidth: isInspire ? 1.5 : 0,
                    borderColor: palette.cardBorder,
                    marginTop: 2,
                  }}
                >
                  <AppIcon name="brandRise" size={14} color={statusMeta.accent} />
                  <Text style={{ color: palette.text, fontSize: 12, fontWeight: '700' }}>{statusMeta.pill}</Text>
                </View>
              </View>
              {!lifetime && plannedForPeriod > 0 ? <ProgressSpeedometer percent={gaugePercent} /> : null}
            </View>

          </Card>
          <View style={[ui.row, { gap: 8, alignItems: 'stretch' }]}>
            {[
              { label: 'Payments', amount: summary.totalPayments, color: palette.posInk },
              { label: 'Budgeted', amount: lifetime ? null : plannedForPeriod, color: palette.text },
              { label: 'Charges', amount: summary.newSpending + summary.totalInterestAndFees, color: palette.neg },
            ].map(metric => (
              <Card key={metric.label} style={{ flex: 1, minWidth: 0, padding: 10, gap: 5 }}>
                 <Text style={[ui.small, { fontWeight: '700' }]}>{metric.label}</Text>
                 <AmountText style={[ui.heading, { color: metric.color, fontSize: 19, fontWeight: '800' }]}
                  value={metric.amount === null ? '—' : formatCurrency(metric.amount, currencySymbol)} />
              </Card>
            ))}
          </View>
          <Card style={[ui.row, { padding: 14, gap: 10, justifyContent: 'space-between' }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={ui.heading}>Net balance change</Text>
              <Text style={ui.small}>{movementTotal < 0 ? 'Net debt reduction' : movementTotal > 0 ? 'Net debt increase' : 'No net change'}</Text>
            </View>
             <AmountText style={[ui.heading, { fontSize: 23, fontWeight: '800', color: movementTotal < 0 ? palette.posInk : movementTotal > 0 ? palette.neg : palette.text }]}
              value={`${movementTotal < 0 ? '↓ ' : movementTotal > 0 ? '↑ ' : ''}${formatCurrency(Math.abs(movementTotal), currencySymbol)}`} />
          </Card>
          <View style={{ gap: 8 }}>
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 2 }]}>
                <Text style={[ui.heading, { fontSize: 17 }]}>Balance activity</Text>
                <Text style={[ui.small, { fontSize: 13, color: palette.posInk, fontWeight: '700' }]}>
                  {accountActivities.length + (accountActivities.length === 1 ? ' account' : ' accounts')}
                </Text>
              </View>
            <Card style={{ gap: 10 }}>
              {accountActivities.length ? (
                <View>
                  {accountActivities.map((item, idx) => {
                    const netChange = item.netChange === 0 ? 0 : item.netChange;
                    return (
                      <View
                        key={item.accountId}
                        style={[
                          ui.row,
                          {
                            minHeight: 56,
                            paddingVertical: 8,
                            borderBottomWidth: idx < accountActivities.length - 1 ? StyleSheet.hairlineWidth : 0,
                            borderColor: palette.border,
                            gap: 12,
                          },
                        ]}
                      >
                        <AccountMark name={item.accountName} category={item.category} />
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text numberOfLines={1} style={[ui.heading, { fontSize: 16 }]}>
                            {item.accountName}
                          </Text>
                          <Text style={[ui.small, { fontSize: 13 }]}>
                            {item.transactionCount + (item.transactionCount === 1 ? ' entry' : ' entries')}
                          </Text>
                        </View>
                        <AmountText
                          style={[
                            ui.value,
                            {
                              fontSize: 16,
                              fontWeight: '700',
                              maxWidth: '48%',
                              textAlign: 'right',
                              color:
                                netChange > 0
                                  ? appearanceColor('#F08B78', isLight)
                                  : netChange < 0
                                  ? appearanceColor('#76DCB9', isLight)
                                  : palette.text,
                            },
                          ]}
                          value={(netChange > 0 ? '↑ ' : netChange < 0 ? '↓ ' : '') + formatCurrency(Math.abs(netChange), currencySymbol)}
                        />
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={[ui.text, { paddingVertical: 10 }]}>No accounts tracked. Add a debt account in Accounts to see balance activity.</Text>
              )}
            </Card>
          </View>
        </View>
      ) : segment === 'Utilization' ? (
        <View style={{ gap: 12 }}>
          <Card style={{ padding: 18, borderRadius: 20, gap: 10 }}>
            <InspireCornerArt kind="hero-utilization" borderRadius={20} />
            {utilization.trackedCardsCount ? (
              <View style={[ui.row, { gap: 16, alignItems: 'center', justifyContent: 'space-between' }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {[
                    { label: 'Total limit', value: formatCurrency(utilization.totalLimit, currencySymbol) },
                    { label: 'Used credit', value: formatCurrency(utilization.totalUsed, currencySymbol) },
                    { label: 'Available credit', value: formatCurrency(utilization.availableCredit, currencySymbol) },
                    { label: 'Target utilization', value: '30%' },
                    { label: 'To reach 30%', value: formatCurrency(toReach30, currencySymbol) },
                  ].map((row, idx, arr) => (
                    <View
                      key={row.label}
                      style={{
                        paddingVertical: 10,
                        borderBottomWidth: idx < arr.length - 1 ? StyleSheet.hairlineWidth : 0,
                        borderBottomColor: palette.border,
                        gap: 2,
                      }}
                    >
                      <Text style={[ui.small, { fontSize: 13 }]}>{row.label}</Text>
                      <AmountText style={[ui.heading, { fontSize: 18 }]} value={row.value} />
                    </View>
                  ))}
                </View>

                <View style={{ width: 156, alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <View style={{ alignSelf: 'flex-end', marginBottom: -8 }}>
                    <InfoButton
                      label="Credit utilization"
                      detail="Used credit includes nonnegative balances on tracked credit cards with a positive credit limit. The marker is the 30% target. Colors vary visually with utilization; existing Good, Watch and High status thresholds are unchanged. Missing limits are excluded from the aggregate."
                    />
                  </View>
                  <View
                    accessible
                    accessibilityLabel={`Overall utilization ${utilization.utilizationPercent}%`}
                    style={{ width: 142, height: 142, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Svg width={142} height={142} viewBox="0 0 142 142" style={{ position: 'absolute' }}>
                      {isInspire ? <Circle cx={71} cy={71} r={55} stroke={palette.graphOutline} strokeWidth={19} fill="none" /> : null}
                      <Circle cx={71} cy={71} r={55} stroke={availTrackColor} strokeWidth={16} fill="none" />
                      {isInspire && donutPercent > 0 ? (
                        <Circle cx={71} cy={71} r={55} stroke={palette.graphOutline} strokeWidth={19} strokeLinecap="round"
                          fill="none" strokeDasharray={`${(donutCircumference * donutPercent) / 100} ${donutCircumference}`} rotation={-90} origin="71, 71" />
                      ) : null}
                      {donutPercent > 0 ? (
                        <Circle
                          cx={71}
                          cy={71}
                          r={55}
                          stroke={usedArcColor}
                          strokeWidth={16}
                          strokeLinecap="round"
                          fill="none"
                          strokeDasharray={`${(donutCircumference * donutPercent) / 100} ${donutCircumference}`}
                          rotation={-90}
                          origin="71, 71"
                        />
                      ) : null}
                    </Svg>
                    <Text style={{ color: palette.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5, lineHeight: 28 }}>
                      {`${utilization.utilizationPercent}%`}
                    </Text>
                    <Text style={{ color: palette.muted, fontSize: 13, fontWeight: '600', lineHeight: 16 }}>Utilization</Text>
                  </View>
                  <Text style={[ui.heading, { fontSize: 17 }]}>{overallUtilStatus}</Text>
                  <View style={[ui.row, { gap: 12, justifyContent: 'center' }]}>
                    <View style={[ui.row, { gap: 5 }]}>
                      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: usedArcColor }} />
                      <Text style={[ui.small, { fontSize: 12 }]}>Used</Text>
                    </View>
                    <View style={[ui.row, { gap: 5 }]}>
                      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: availTrackColor }} />
                      <Text style={[ui.small, { fontSize: 12 }]}>Available</Text>
                    </View>
                  </View>
                </View>
              </View>
            ) : (
              <Text style={ui.text}>Unavailable. Add credit limits in Debt accounts.</Text>
            )}
          </Card>

          <View style={[ui.row, { gap: 10 }]}>
            <Card style={{ flex: 1, padding: 14, borderRadius: 16, gap: 6 }}>
              <InspireCornerArt kind="corner-wave" />
              <Text style={[ui.small, { fontSize: 13 }]}>Missing credit limits</Text>
              <Text style={[ui.heading, { fontSize: 19 }]}>{creditCards.length - utilization.trackedCardsCount}</Text>
            </Card>
            <Card style={{ flex: 1, padding: 14, borderRadius: 16, gap: 6 }}>
              <InspireCornerArt kind="corner-ridge" />
              <Text style={[ui.small, { fontSize: 13 }]}>Cards tracked</Text>
              <Text style={[ui.heading, { fontSize: 19 }]}>{utilization.trackedCardsCount}</Text>
            </Card>
          </View>

          {advisor ? (
            <Card style={{ padding: 16, borderRadius: 18, gap: 8 }}>
              <Text style={[ui.small, { fontSize: 11, fontWeight: '700' }]}>FASTEST UTILIZATION LIFT</Text>
              <Text style={[ui.heading, { fontSize: 17 }]}>30% Target Advisor</Text>
              <Text style={ui.heading}>{`${advisor.cardName} · ${Math.round(advisor.currentPercent)}% → 30%`}</Text>
              <Text style={ui.small}>{`Pay ${formatCurrency(advisor.paydownTo30, currencySymbol)} · Overall → ${Math.round(advisor.projectedOverallPercent)}%`}</Text>
              <Pressable accessibilityRole="button" onPress={() => onSimulateExtra ? onSimulateExtra(advisor.paydownTo30) : onOpenStrategy?.()} style={{ alignSelf: 'flex-start', backgroundColor: palette.brand, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Simulate</Text>
              </Pressable>
            </Card>
          ) : null}

          {creditCards.length ? (
            <View style={{ gap: 12 }}>
              {creditCards.map(debt => {
                const card = calculateCreditUtilization([debt], currencyCode);
                const known = card.trackedCardsCount > 0;
                const paydown = known ? Math.max(0, Math.max(0, debt.balance) - (debt.creditLimit ?? 0) * 0.3) : 0;
                const cardColors = utilizationBadgeColors(
                  card.statusBand,
                  isLight,
                  palette.muted,
                  palette.raised,
                  palette.border,
                );
                const fillWidth = `${Math.max(0, Math.min(100, card.utilizationPercent))}%` as DimensionValue;

                return (
                  <Pressable
                    key={debt.id}
                    accessibilityRole="button"
                    disabled={!onSelectDebt}
                    accessibilityLabel={
                      debt.name +
                      ': ' +
                      (known
                        ? formatCurrency(card.totalUsed, currencySymbol) +
                          ' used, ' +
                          card.utilizationPercent +
                          '% utilization; target 30%'
                        : 'credit limit unavailable')
                    }
                    onPress={() => onSelectDebt?.(debt.id)}
                  >
                    <Card style={{ padding: 16, borderRadius: 18, gap: 12 }}>
                      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 10 }]}>
                        <View style={[ui.row, { flex: 1, minWidth: 0, gap: 10 }]}>
                          <AccountMark name={debt.name} category={debt.category} />
                          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                            <Text numberOfLines={1} style={[ui.heading, { fontSize: 16 }]}>
                              {debt.name}
                            </Text>
                            <Text numberOfLines={1} style={[ui.small, { fontSize: 13 }]}>
                              {`${debt.apr.toFixed(2)}% APR`}
                            </Text>
                          </View>
                        </View>
                        <View style={[ui.row, { gap: 8, alignItems: 'center', flexShrink: 0 }]}>
                          <View style={{ alignItems: 'center', gap: 4 }}>
                            <View
                              style={{
                                paddingHorizontal: 12,
                                paddingVertical: 5,
                                borderRadius: 999,
                                backgroundColor: known ? cardColors.solidBg : palette.raised,
                                minWidth: 66,
                                alignItems: 'center',
                              }}
                            >
                              <Text style={{ color: known ? '#FFFFFF' : palette.muted, fontSize: 14, fontWeight: '700' }}>
                                {known ? `${card.utilizationPercent}%` : 'No limit'}
                              </Text>
                            </View>
                            {known ? (
                              <Text style={{ color: cardColors.color, fontSize: 12, fontWeight: '600' }}>
                                {card.utilizationPercent > 100 ? 'Over limit' : cardColors.label}
                              </Text>
                            ) : null}
                          </View>
                          <AppIcon name="chevronRight" size={16} color={palette.brand} />
                        </View>
                      </View>

                      <View style={{ gap: 6 }}>
                        <View
                          style={{
                            height: 12,
                            borderRadius: 6,
                            backgroundColor: palette.raised,
                            borderWidth: isInspire ? 1 : 0,
                            borderColor: palette.graphOutline,
                            position: 'relative',
                          }}
                        >
                          {known ? (
                            <View
                              style={{
                                width: fillWidth,
                                height: '100%',
                                borderRadius: 6,
                                backgroundColor: cardColors.barColor,
                                borderWidth: isInspire ? 1 : 0,
                                borderColor: palette.graphOutline,
                              }}
                            />
                          ) : null}
                          <View
                            style={{
                              position: 'absolute',
                              left: '30%',
                              top: -4,
                              height: 20,
                              width: 2,
                              backgroundColor: palette.text,
                              borderRadius: 1,
                            }}
                          />
                        </View>
                        <Text style={[ui.small, { fontSize: 13, textAlign: 'center' }]}>30% target</Text>
                      </View>

                      <View
                        style={[
                          ui.row,
                          {
                            justifyContent: 'space-between',
                            paddingTop: 10,
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: palette.border,
                          },
                        ]}
                      >
                        <Text style={[ui.small, { fontSize: 14 }]}>Balance</Text>
                        <AmountText
                          style={[ui.heading, { fontSize: 18 }]}
                          value={formatCurrency(Math.max(0, debt.balance), currencySymbol)}
                        />
                      </View>

                      <View
                        style={[
                          ui.row,
                          {
                            paddingTop: 10,
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: palette.border,
                            gap: 12,
                          },
                        ]}
                      >
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={[ui.small, { fontSize: 13 }]}>Limit</Text>
                          <AmountText
                            style={[ui.heading, { fontSize: 17 }]}
                            value={known ? formatCurrency(card.totalLimit, currencySymbol) : '—'}
                          />
                        </View>
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={[ui.small, { fontSize: 13 }]}>Available</Text>
                          <AmountText
                            style={[ui.heading, { fontSize: 17 }]}
                            value={known ? formatCurrency(card.availableCredit, currencySymbol) : '—'}
                          />
                        </View>
                      </View>

                      <View
                        style={[
                          ui.row,
                          {
                            justifyContent: 'space-between',
                            paddingTop: 10,
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: palette.border,
                          },
                        ]}
                      >
                        <Text style={[ui.small, { fontSize: 14, color: palette.text }]}>Paydown targets</Text>
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: '600',
                            color: !known ? palette.muted : paydown > 0 ? cardColors.color : appearanceColor('#76DCB9', isLight),
                          }}
                        >
                          {known
                            ? paydown > 0
                              ? `To 30%: ${formatCurrency(paydown, currencySymbol)}`
                              : 'Within 30% target'
                            : 'Add credit limit'}
                        </Text>
                      </View>
                    </Card>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Card style={{ padding: 14, borderRadius: 16 }}>
              <Text style={ui.text}>No credit cards tracked.</Text>
            </Card>
          )}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Card style={{ paddingHorizontal: 16, paddingVertical: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <InspireCornerArt kind="hero-milestones" borderRadius={18} />
            <AwardSeal earned={earnedCount > 0} size={68} />
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text style={[ui.small, { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }]}>YOUR PROGRESS</Text>
              <Text style={[ui.title, { fontSize: 26, lineHeight: 30 }]}>
                {`${earnedCount} `}
                <Text style={{ fontSize: 17, fontWeight: '500' }}>{earnedCount === 1 ? 'achievement' : 'achievements'}</Text>
              </Text>
              <Text style={ui.small}>{inProgressCount + ' in progress - ' + lockedCount + ' locked'}</Text>
            </View>
          </Card>

          <Card style={{ padding: 14, gap: 10 }}>
            <InspireCornerArt kind="hero-paid" />
            <View style={[ui.row, { justifyContent: 'space-between', gap: 8 }]}>
              <Text accessibilityRole="header" style={[ui.heading, { flex: 1 }]}>Paid Off Accounts</Text>
              <View style={{ borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: palette.posSoft, borderWidth: isInspire ? 1.5 : 0, borderColor: palette.cardBorder }}>
                <Text style={{ color: palette.posInk, fontWeight: '700' }}>{paidOffDebts.length} Paid Off</Text>
              </View>
            </View>
            {paidOffDebts.length ? paidOffDebts.map(debt => (
              <View key={debt.id} style={[ui.row, { gap: 9 }]}>
                <AccountMark name={debt.name} category={debt.category} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={ui.heading}>{debt.name}</Text>
                  {debt.originalBalance !== null && debt.originalBalance > 0 ? (
                    <Text style={ui.small}>{formatCurrency(debt.originalBalance, currencySymbol)} original balance</Text>
                  ) : null}
                </View>
                <AmountText style={[ui.heading, { color: palette.posInk }]} value={formatCurrency(debt.balance, currencySymbol)} />
              </View>
            )) : <Text style={ui.small}>No accounts marked paid off.</Text>}
          </Card>

          <Card style={{ padding: 16, borderRadius: 18, gap: 12 }}>
            <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <Text style={ui.heading}>Your path</Text>
              <View style={{ marginVertical: -12 }}>
                <InfoButton
                  label="Milestone evidence"
                  detail="Recorded achievements use confirmed payments, excluding pending and reconciliation entries. Payment balance reduction does not infer principal from unallocated loan payments. Utilization is a current-state goal and can change; it is not a historical award. Payoff milestones need recorded payoff events and complete history coverage."
                />
              </View>
            </View>
            <View>
              {recorded.map((item, index) => {
                const isLast = index === recorded.length - 1;
                return (
                  <View key={item.id} style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ width: 34, alignItems: 'center' }}>
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 17,
                          backgroundColor:
                            item.status === 'completed'
                              ? appearanceColor('#76DCB9', isLight)
                              : appearanceColor('#1E2C28', isLight),
                          borderWidth: 1,
                          borderColor: appearanceColor('#76DCB9', isLight),
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <AppIcon
                          name={item.status === 'completed' ? 'check' : 'bolt'}
                          size={17}
                          color={
                            item.status === 'completed'
                              ? isLight
                                ? '#FFFFFF'
                                : '#0C0E0D'
                              : appearanceColor('#76DCB9', isLight)
                          }
                        />
                      </View>
                      {!isLast ? (
                        <View style={{ flex: 1, width: 1.5, minHeight: 16, backgroundColor: palette.border, marginVertical: 4 }} />
                      ) : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 4, paddingBottom: isLast ? 0 : 14, paddingTop: 2 }}>
                      {nextUnlock?.id === item.id ? (
                        <Text style={[ui.small, { fontSize: 12, fontWeight: '700' }]}>NEXT UNLOCK</Text>
                      ) : null}
                      <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', gap: 8 }]}>
                        <Text style={[ui.heading, { flex: 1, fontSize: 16 }]}>{titleFor(item)}</Text>
                        <View style={{ marginVertical: -12 }}>
                          <InfoButton label={titleFor(item)} detail={item.description} />
                        </View>
                      </View>
                      <Text style={ui.small}>
                        {item.status === 'completed'
                          ? 'Recorded' + (item.earnedDate ? ' - ' + item.earnedDate : '')
                          : item.id === 'first_1000'
                          ? formatCurrency(item.currentValue, currencySymbol) +
                            ' of ' +
                            formatCurrency(item.targetValue, currencySymbol) +
                            ' - ' +
                            Math.max(0, item.percent) +
                            '%'
                          : 'Record your first payment'}
                      </Text>
                      {item.status === 'in_progress' && item.id === 'first_1000' ? (
                        <>
                          <Bar percent={item.percent} />
                          <View
                            style={{
                              alignSelf: 'flex-start',
                              marginTop: 4,
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: 6,
                              backgroundColor: isLight ? '#E6F4F0' : 'rgba(118, 220, 185, 0.15)',
                            }}
                          >
                            <Text style={{ color: appearanceColor('#76DCB9', isLight), fontSize: 12, fontWeight: '700' }}>
                              {Math.max(0, item.percent)}%
                            </Text>
                          </View>
                        </>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>

          {currentGoal
            ? (() => {
                const goalBand =
                  currentGoal.status === 'completed'
                    ? 'good'
                    : currentGoal.currentValue > 50
                    ? 'high'
                    : currentGoal.status === 'locked'
                    ? 'unavailable'
                    : 'moderate';
                const goalBadge = utilizationBadgeColors(
                  goalBand,
                  isLight,
                  palette.muted,
                  palette.raised,
                  palette.border,
                );
                return (
                  <Card style={{ padding: 14, borderRadius: 16, gap: 4 }}>
                    <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                      <Text style={[ui.small, { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 }]}>
                        {nextUnlock?.id === currentGoal.id ? 'NEXT UNLOCK - CURRENT GOAL' : 'CURRENT GOAL'}
                      </Text>
                      <View
                        style={{
                          backgroundColor: goalBadge.bg,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: goalBadge.border,
                        }}
                      >
                        <Text style={{ color: goalBadge.color, fontSize: 12, fontWeight: '700' }}>
                          {currentGoal.currentValue}%
                        </Text>
                      </View>
                    </View>
                    <Text style={[ui.heading, { fontSize: 16 }]}>Credit utilization ≤ 30%</Text>
                    <Text style={ui.small}>Current state - not a historical award</Text>
                  </Card>
                );
              })()
            : null}

          <Card style={{ padding: 14, borderRadius: 16, gap: 6 }}>
            <View style={{ gap: 2 }}>
              <Text style={[ui.heading, { fontSize: 16 }]}>Payoff milestones</Text>
              <Text style={ui.small}>Locked - complete history needed</Text>
            </View>
            {lockedHistory.map((item, idx) => (
              <View
                key={item.id}
                style={[
                  ui.row,
                  {
                    justifyContent: 'space-between',
                    gap: 12,
                    paddingTop: 8,
                    paddingBottom: idx < lockedHistory.length - 1 ? 6 : 0,
                    borderTopWidth: 1,
                    borderTopColor: palette.border,
                  },
                ]}
              >
                <Text style={[ui.text, { flex: 1 }]}>{item.title}</Text>
                <View style={{ marginVertical: -10 }}>
                  <InfoButton label={item.title} detail={item.description} />
                </View>
              </View>
            ))}
          </Card>
        </View>
      )}
        </>
      )}
    />
    {showDate ? <PeriodDateSheet value={selectedPeriod} currentYear={currentYear} earliestYear={earliestYear}
      onSelect={setPeriod} onClose={() => setShowDate(false)} /> : null}
    </>
  );
});
