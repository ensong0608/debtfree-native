import { useState } from 'react';
import { StyleSheet, type DimensionValue } from 'react-native';
import Svg, { Circle, Defs, Line, Path, RadialGradient, Stop } from 'react-native-svg';
import { AmountText } from '../components/AmountText';
import { AppIcon, type AppIconName } from '../components/AppIcon';
import { Bar, Card, FinancialScreen, ui } from '../components/FinancialScreen';
import { InformationButton as InfoButton } from '../components/InformationSheet';
import { InspireQuote } from '../components/InspireArt';
import { Pressable, Text, View, appearanceColor, useNativeAppearance } from '../components/NativeAppearance';
import { currentHouseholdDate, getPreviousMonthString } from '../finance/calendar';
import { isPaidOffAccountArchived, type LedgerTransaction } from '../finance/ledger';
import { calculateAccountActivities, calculateActivitySummary, calculateCreditUtilization, calculateMilestones, type ProgressPeriod } from '../finance/progress';
import { formatCurrency, type DebtItem, type PayoffStrategy } from '../onboarding-domain';

const PERIOD_ITEMS = ['This Month', 'Previous', 'Lifetime'] as const;
const GAUGE_SEGMENT_COLORS = [
  '#E67E22',
  '#F39C12',
  '#F1C40F',
  '#A3D944',
  '#58C46D',
  '#2E9D68',
  '#1C6E4D',
] as const;

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
  const { palette } = useNativeAppearance();
  const clamped = Math.max(0, Math.min(200, percent));
  const needleAngle = 180 - (clamped / 200) * 180;
  const cx = 74;
  const cy = 70;
  const radius = 54;
  const tip = polarPoint(cx, cy, 44, needleAngle);
  const segCount = GAUGE_SEGMENT_COLORS.length;
  const totalSpan = 180;
  const gap = 3;
  const segSpan = (totalSpan - gap * (segCount - 1)) / segCount;

  return (
    <View style={{ width: 148, alignItems: 'center', flexShrink: 0 }}>
      <Svg width={148} height={82} viewBox="0 0 148 82" accessible={false}>
        {GAUGE_SEGMENT_COLORS.map((color, idx) => {
          const start = 180 - idx * (segSpan + gap);
          const end = start - segSpan;
          return (
            <Path
              key={color}
              d={describeArc(cx, cy, radius, start, end)}
              fill="none"
              stroke={color}
              strokeWidth={12}
              strokeLinecap="butt"
            />
          );
        })}
        <Line
          x1={cx}
          y1={cy}
          x2={tip.x}
          y2={tip.y}
          stroke={palette.text}
          strokeWidth={2.8}
          strokeLinecap="round"
        />
        <Circle cx={cx} cy={cy} r={5} fill={palette.text} />
      </Svg>
      <View style={[ui.row, { width: '100%', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: -4 }]}>
        <Text style={[ui.small, { fontSize: 12 }]}>0%</Text>
        <Text style={[ui.small, { fontSize: 12 }]}>200%+</Text>
      </View>
      <Text style={[ui.title, { fontSize: 22, lineHeight: 26, marginTop: -6 }]}>{`${Math.round(percent)}%`}</Text>
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

export function ProgressScreen({
  debts,
  transactions = [],
  currencySymbol = '$',
  currencyCode = 'USD',
  plannedMonthlyPayment,
  archivedPaidOffDebtIds = [],
  householdTimeZone,
  onSettings,
  onSelectDebt,
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
}) {
  const [tab, setTab] = useState('Overview');
  const [period, setPeriod] = useState<typeof PERIOD_ITEMS[number]>('This Month');
  const { isLight, isInspire, palette, accentColor } = useNativeAppearance();

  const today = currentHouseholdDate(householdTimeZone);
  const currentMonthStr = today.slice(0, 7);
  const previousMonthStr = getPreviousMonthString(currentMonthStr);
  const mappedPeriod: ProgressPeriod =
    period === 'This Month' ? 'current_month' : period === 'Previous' ? 'previous_month' : 'lifetime';

  const summary = calculateActivitySummary({ transactions, debts, period: mappedPeriod, today, currencyCode });
  const accountActivities = calculateAccountActivities({ transactions, debts, period: mappedPeriod, today, currencyCode });
  const activeProgressDebts = debts.filter(debt => !isPaidOffAccountArchived(debt, archivedPaidOffDebtIds));
  const archivedUtilizationDebtIds = debts
    .filter(debt => isPaidOffAccountArchived(debt, archivedPaidOffDebtIds))
    .map(debt => debt.id);
  const utilization = calculateCreditUtilization(activeProgressDebts, currencyCode);
  const milestones = calculateMilestones({
    debts,
    transactions,
    currencyCode,
    excludedUtilizationDebtIds: archivedUtilizationDebtIds,
  });
  const hasPending = transactions.some(tx => tx.isPending && tx.deletedAt === null && tx.accountId !== null);

  const monthHeading = (monthStr: string) =>
    `${new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${monthStr}-01T12:00:00Z`),
    )} progress`;

  const progressHeading =
    period === 'This Month'
      ? monthHeading(currentMonthStr)
      : period === 'Previous'
      ? monthHeading(previousMonthStr)
      : 'Lifetime progress';

  const fallbackPlanned = activeProgressDebts
    .filter(d => d.balance > 0)
    .reduce((sum, d) => sum + Math.max(0, d.minimumPayment), 0);
  const plannedForPeriod =
    period === 'Lifetime' ? 0 : Math.max(0, plannedMonthlyPayment ?? fallbackPlanned);

  const gaugePercent =
    period === 'Lifetime'
      ? summary.totalPayments > 0
        ? 100
        : 0
      : plannedForPeriod > 0
      ? Math.round((summary.totalPayments / plannedForPeriod) * 100)
      : summary.totalPayments > 0
      ? 100
      : 0;

  const planDelta = summary.totalPayments - plannedForPeriod;
  const isAhead = period !== 'Lifetime' && plannedForPeriod > 0 && planDelta >= 0;
  const isBehind = period !== 'Lifetime' && plannedForPeriod > 0 && planDelta < 0;

  const statusMeta =
    period === 'Lifetime'
      ? {
          title: 'Lifetime total',
          subtitle: `${summary.transactionsCount} confirmed ${summary.transactionsCount === 1 ? 'entry' : 'entries'}`,
          pill: `${formatCurrency(summary.principalReduction, currencySymbol)} principal paid`,
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
          pill: `${gaugePercent}% of target`,
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
  const usedArcColor = appearanceColor('#76DCB9', isLight, accentColor);
  const availTrackColor = isLight ? '#E6ECF4' : palette.raised;
  const donutCircumference = 2 * Math.PI * 55;
  const donutPercent = Math.max(0, Math.min(100, utilization.utilizationPercent));

  return (
    <FinancialScreen
      title="Progress"
      segments={['Overview', 'Utilization', 'Milestones']}
      selected={tab}
      onSelect={setTab}
      onSettings={onSettings}
    >
      {hasPending ? (
        <View style={ui.row}>
          <Text style={[ui.small, { color: appearanceColor('#F5C563', isLight), flex: 1 }]}>
            Balances provisional · payments pending
          </Text>
          <InfoButton
            label="Pending changes"
            detail="Displayed balances are provisional while debt changes await confirmation. Unconfirmed payments are excluded from recorded activity and payment milestones."
          />
        </View>
      ) : null}

      {tab === 'Overview' ? (
        <View style={{ gap: 12 }}>
          <Card style={{ padding: 16, borderRadius: 20, gap: 16 }}>
            <Text accessibilityRole="header" style={[ui.title, { fontSize: 22 }]}>
              {progressHeading}
            </Text>

            <View
              style={{
                flexDirection: 'row',
                backgroundColor: isInspire ? palette.tint : isLight ? '#EEF2F7' : '#181A1F',
                borderRadius: 14,
                padding: 4,
                gap: 4,
                borderWidth: 1,
                borderColor: palette.border,
              }}
            >
              {PERIOD_ITEMS.map(item => {
                const active = period === item;
                const activeBg = isLight ? palette.brand : accentColor === 'Cobalt' ? '#70CEFF' : palette.brand;
                return (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setPeriod(item)}
                    style={{
                      flex: 1,
                      minHeight: 42,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingHorizontal: 6,
                      backgroundColor: active ? activeBg : 'transparent',
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                      style={{
                        color: active ? palette.onBrand : palette.muted,
                        fontSize: 15,
                        fontWeight: active ? '800' : '700',
                      }}
                    >
                      {item}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View
              style={{
                backgroundColor: statusMeta.bannerBg,
                borderRadius: 16,
                paddingHorizontal: 14,
                paddingVertical: 14,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                <Text style={[ui.title, { fontSize: 22, letterSpacing: -0.4 }]}>{statusMeta.title}</Text>
                <Text style={{ color: statusMeta.accent, fontSize: 14, fontWeight: '600' }}>
                  {statusMeta.subtitle}
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
                    backgroundColor: statusMeta.pillBg,
                    marginTop: 2,
                  }}
                >
                  <AppIcon name="brandRise" size={14} color={statusMeta.accent} />
                  <Text style={{ color: palette.muted, fontSize: 13, fontWeight: '600' }}>{statusMeta.pill}</Text>
                </View>
              </View>
              <ProgressSpeedometer percent={gaugePercent} />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ gap: 2, flex: 1 }}>
                <View style={[ui.row, { gap: 4 }]}>
                  <Text style={[ui.small, { fontSize: 14 }]}>Recorded</Text>
                  <View style={{ marginVertical: -12 }}>
                    <InfoButton
                      color={palette.muted}
                      label="Recorded activity"
                      detail={
                        'History coverage\nRecorded history may be incomplete. Recorded account payoff events are unavailable.\n\nPayment amounts\nTotal payments and balance reduction are different. Loan payments without a principal allocation may not reduce the balance.\n\nBalance changes\nNet change can include spending, refunds, fees and adjustments; not every component is shown as a separate row.'
                      }
                    />
                  </View>
                </View>
                <AmountText
                  style={[ui.title, { fontSize: 32, letterSpacing: -0.8, color: isLight ? '#087D42' : '#76DCB9' }]}
                  value={formatCurrency(summary.totalPayments, currencySymbol)}
                />
                <Text style={[ui.small, { fontSize: 15 }]}>
                  {period !== 'Lifetime' && plannedForPeriod > 0
                    ? `${formatCurrency(plannedForPeriod, currencySymbol)} planned`
                    : `${summary.transactionsCount} confirmed ${summary.transactionsCount === 1 ? 'entry' : 'entries'}`}
                </Text>
              </View>
              <InspireQuote
                slot="progressRecorded"
                tiltDeg={-3}
                color="#0B89A8"
                style={{ maxWidth: 135, textAlign: 'right' }}
              />
            </View>

            <View style={[ui.row, { gap: 10, alignItems: 'stretch' }]}>
              <Card style={{ flex: 1, padding: 14, borderRadius: 14, gap: 8, shadowOpacity: 0, elevation: 0 }}>
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: isLight ? '#F3EEFC' : 'rgba(167, 139, 250, 0.16)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AppIcon name="progress" size={15} color={appearanceColor('#A78BFA', isLight)} />
                </View>
                <Text style={[ui.small, { fontSize: 13, lineHeight: 17 }]}>Interest & Fees recorded</Text>
                <AmountText
                  style={[ui.heading, { fontSize: 18 }]}
                  value={formatCurrency(summary.totalInterestAndFees, currencySymbol)}
                />
              </Card>
              <Card style={{ flex: 1, padding: 14, borderRadius: 14, gap: 8, shadowOpacity: 0, elevation: 0 }}>
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: isLight ? '#EBF7F1' : 'rgba(118, 220, 185, 0.16)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AppIcon name="trendDown" size={15} color={appearanceColor('#76DCB9', isLight)} />
                </View>
                <Text style={[ui.small, { fontSize: 13, lineHeight: 17 }]}>Recorded balance change</Text>
                <AmountText
                  style={[ui.heading, { fontSize: 18 }]}
                  value={
                    (summary.netBalanceChange > 0 ? '+' : summary.netBalanceChange < 0 ? '−' : '') +
                    formatCurrency(Math.abs(summary.netBalanceChange), currencySymbol)
                  }
                />
              </Card>
            </View>

            <View style={{ paddingTop: 4, gap: 6 }}>
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 6 }]}>
                <Text style={[ui.heading, { fontSize: 17 }]}>Activity by account</Text>
                <Text style={[ui.small, { fontSize: 13 }]}>
                  {accountActivities.length + (accountActivities.length === 1 ? ' account' : ' accounts')}
                </Text>
              </View>
              {accountActivities.length ? (
                <View>
                  {accountActivities.map((item, idx) => {
                    const debt = debts.find(d => d.id === item.accountId);
                    const catColor =
                      debt?.category === 'Credit card'
                        ? appearanceColor('#76DCB9', isLight)
                        : debt?.category === 'Auto loan'
                        ? appearanceColor('#60A5FA', isLight)
                        : debt?.category === 'Student loan'
                        ? appearanceColor('#F5C563', isLight)
                        : appearanceColor('#60A5FA', isLight);
                    const catIcon: AppIconName =
                      debt?.category === 'Credit card'
                        ? 'creditCard'
                        : debt?.category === 'Auto loan'
                        ? 'auto'
                        : debt?.category === 'Student loan'
                        ? 'bolt'
                        : 'homeLoan';
                    const netChange = item.netChange === 0 ? 0 : item.netChange;
                    return (
                      <View
                        key={item.accountId}
                        style={[
                          ui.row,
                          {
                            minHeight: 56,
                            paddingVertical: 8,
                            borderTopWidth: idx === 0 ? StyleSheet.hairlineWidth : 0,
                            borderBottomWidth: idx < accountActivities.length - 1 ? StyleSheet.hairlineWidth : 0,
                            borderColor: palette.border,
                            gap: 12,
                          },
                        ]}
                      >
                        <View
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 19,
                            backgroundColor: catColor + '18',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <AppIcon name={catIcon} size={18} color={catColor} />
                        </View>
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
                          value={(netChange > 0 ? '+' : netChange < 0 ? '−' : '') + formatCurrency(Math.abs(netChange), currencySymbol)}
                        />
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={[ui.text, { paddingVertical: 10 }]}>No accounts tracked.</Text>
              )}
            </View>
          </Card>
        </View>
      ) : tab === 'Utilization' ? (
        <View style={{ gap: 12 }}>
          <Card style={{ padding: 18, borderRadius: 20, gap: 10 }}>
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
                      <Circle cx={71} cy={71} r={55} stroke={availTrackColor} strokeWidth={16} fill="none" />
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
              <Text style={[ui.small, { fontSize: 13 }]}>Available credit</Text>
              <AmountText
                style={[ui.heading, { fontSize: 19 }]}
                value={formatCurrency(utilization.availableCredit, currencySymbol)}
              />
            </Card>
            <Card style={{ flex: 1, padding: 14, borderRadius: 16, gap: 6 }}>
              <Text style={[ui.small, { fontSize: 13 }]}>Cards tracked</Text>
              <Text style={[ui.heading, { fontSize: 19 }]}>{utilization.trackedCardsCount}</Text>
            </Card>
          </View>

          {creditCards.length ? (
            <View style={{ gap: 12 }}>
              {creditCards.map((debt, index) => {
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
                const iconColor = index % 2 === 0 ? appearanceColor('#60A5FA', isLight) : appearanceColor('#76DCB9', isLight);
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
                          <View
                            style={{
                              width: 38,
                              height: 38,
                              borderRadius: 19,
                              backgroundColor: iconColor + '18',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <AppIcon name="creditCard" size={19} color={iconColor} />
                          </View>
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
                            backgroundColor: isLight ? '#E8EEF5' : palette.raised,
                            position: 'relative',
                          }}
                        >
                          {known ? (
                            <View
                              style={{
                                width: fillWidth,
                                height: 12,
                                borderRadius: 6,
                                backgroundColor: cardColors.barColor,
                              }}
                            />
                          ) : null}
                          <View
                            style={{
                              position: 'absolute',
                              left: '30%',
                              top: -4,
                              height: 20,
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <View style={{ width: 2, height: 5, backgroundColor: palette.text, borderRadius: 1 }} />
                            <View style={{ width: 2, height: 5, backgroundColor: palette.text, borderRadius: 1 }} />
                            <View style={{ width: 2, height: 5, backgroundColor: palette.text, borderRadius: 1 }} />
                          </View>
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
            <AwardSeal earned={earnedCount > 0} size={68} />
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text style={[ui.small, { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }]}>YOUR PROGRESS</Text>
              <Text style={[ui.title, { fontSize: 26, lineHeight: 30 }]}>
                {`${earnedCount} `}
                <Text style={{ fontSize: 17, fontWeight: '500' }}>{earnedCount === 1 ? 'achievement' : 'achievements'}</Text>
              </Text>
              <Text style={ui.small}>{inProgressCount + ' in progress · ' + lockedCount + ' locked'}</Text>
            </View>
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
                          ? 'Recorded' + (item.earnedDate ? ' · ' + item.earnedDate : '')
                          : item.id === 'first_1000'
                          ? formatCurrency(item.currentValue, currencySymbol) +
                            ' of ' +
                            formatCurrency(item.targetValue, currencySymbol) +
                            ' · ' +
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
                        {nextUnlock?.id === currentGoal.id ? 'NEXT UNLOCK · CURRENT GOAL' : 'CURRENT GOAL'}
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
                    <Text style={ui.small}>Current state · not a historical award</Text>
                  </Card>
                );
              })()
            : null}

          <Card style={{ padding: 14, borderRadius: 16, gap: 6 }}>
            <View style={{ gap: 2 }}>
              <Text style={[ui.heading, { fontSize: 16 }]}>Payoff milestones</Text>
              <Text style={ui.small}>Locked · complete history needed</Text>
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
    </FinancialScreen>
  );
}
