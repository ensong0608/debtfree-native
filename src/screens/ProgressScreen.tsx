import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppIcon } from '../components/AppIcon';
import {
  Bar,
  Card,
  FinancialScreen,
  Ring,
  Segments,
  ui,
} from '../components/FinancialScreen';
import { calculateBalanceSnapshot, formatCurrency, sortDebtsByStrategy, type DebtItem, type PayoffStrategy } from '../onboarding-domain';
import {
  calculateActivitySummary,
  calculateAccountActivities,
  calculateCreditUtilization,
  calculateMilestones,
  type ProgressPeriod,
} from '../finance/progress';
import { parseDateOnly } from '../finance/calendar';
import type { LedgerTransaction } from '../finance/ledger';

const PERIOD_ITEMS = ['Current month', 'Previous month', 'Lifetime'] as const;

export function ProgressScreen({
  debts,
  transactions = [],
  currencySymbol = '$',
  strategy = 'avalanche',
  onSettings,
  onSelectDebt,
}: {
  debts: DebtItem[];
  transactions?: LedgerTransaction[];
  currencySymbol?: string;
  strategy?: PayoffStrategy;
  onSettings: () => void;
  onSelectDebt?: (debtId: string) => void;
}) {
  const [tab, setTab] = useState('Overview');
  const [period, setPeriod] = useState<typeof PERIOD_ITEMS[number]>('Current month');

  const today = parseDateOnly(new Date().toISOString().slice(0, 10));
  const mappedPeriod: ProgressPeriod =
    period === 'Current month'
      ? 'current_month'
      : period === 'Previous month'
        ? 'previous_month'
        : 'lifetime';

  // Compute live financial analytics
  const summary = calculateActivitySummary({
    transactions,
    debts,
    period: mappedPeriod,
    today,
  });

  const accountActivities = calculateAccountActivities({
    transactions,
    debts,
    period: mappedPeriod,
    today,
  });

  const hasUnconfirmedDebtWrites = transactions.some(tx => tx.isPending && tx.accountId !== null);
  const utilization = calculateCreditUtilization(debts);
  const milestones = calculateMilestones({ debts, transactions });

  const completedCount = milestones.filter(m => m.status === 'completed').length;
  const inProgressCount = milestones.filter(m => m.status === 'in_progress').length;
  const lockedCount = milestones.filter(m => m.status === 'locked').length;
  const nextUnlock = milestones.find(m => m.status === 'in_progress');
  const balanceSnapshot = calculateBalanceSnapshot(debts);
  const payoffTarget = sortDebtsByStrategy(debts, strategy)[0];
  const overallProgress = Math.max(0, Math.min(100, balanceSnapshot.percent));

  return (
    <FinancialScreen
      title={
        tab === 'Utilization'
          ? 'Credit utilization'
          : tab === 'Milestones'
            ? 'Milestones'
            : 'Progress'
      }
      segments={['Overview', 'Utilization', 'Milestones']}
      selected={tab}
      onSelect={setTab}
      onSettings={onSettings}
    >
      {hasUnconfirmedDebtWrites ? (
        <Text style={[ui.small, { color: '#E3A088', marginBottom: 8 }]}>Pending changes: displayed balances and payoff percentages are provisional. Achievements await server confirmation.</Text>
      ) : null}
      {tab === 'Overview' ? (
        <>
          <Card style={{ gap: 14, paddingVertical: 18 }}>
            <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={ui.small}>OVERALL DEBT PAYOFF</Text>
                <Text style={[ui.heading, { fontSize: 22 }]}>{`${Math.round(overallProgress)}% ${hasUnconfirmedDebtWrites ? 'provisional payoff' : 'paid down'}`}</Text>
                <Text style={ui.text}>{`${formatCurrency(balanceSnapshot.balance, currencySymbol)} remaining`}</Text>
              </View>
              <Ring percent={overallProgress} label="paid down" />
            </View>
            <View style={[ui.divider, { paddingTop: 12 }]}>
              <Text style={ui.small}>NEXT PAYOFF TARGET · {strategy.toUpperCase()}</Text>
              {payoffTarget ? (
                <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={ui.heading}>{payoffTarget.name}</Text>
                    <Text style={ui.small}>{`${payoffTarget.apr}% APR · ${formatCurrency(payoffTarget.balance, currencySymbol)} balance`}</Text>
                  </View>
                  <Text style={[ui.value, { fontSize: 14 }]}>#1</Text>
                </View>
              ) : <Text style={[ui.heading, { marginTop: 6 }]}>No active payoff target</Text>}
            </View>
          </Card>

          <Card>
            <Text style={ui.heading}>{`${period} activity`}</Text>
            <Segments
              items={PERIOD_ITEMS}
              selected={period}
              onSelect={v => setPeriod(v as typeof PERIOD_ITEMS[number])}
            />

            <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={[ui.badge, { alignSelf: 'flex-start', backgroundColor: '#1E2C28' }]}>
                  <Text style={[ui.badgeText, { color: '#81DFD2' }]}>
                    {summary.transactionsCount > 0 ? `${summary.transactionsCount} TRANSACTIONS` : 'NO RECORDED ACTIVITY'}
                  </Text>
                </View>
                <Text style={ui.heading}>
                  {summary.debtPaidDown > 0
                    ? `${formatCurrency(summary.debtPaidDown, currencySymbol)} paid down`
                    : summary.totalPayments > 0
                      ? `${formatCurrency(summary.totalPayments, currencySymbol)} in payments`
                      : 'No payments in this period'}
                </Text>
                <Text style={ui.small}>{summary.transactionsCount > 0 ? 'From recorded activity' : 'No activity recorded'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={ui.small}>Payments</Text>
                <Text style={ui.value}>{formatCurrency(summary.totalPayments, currencySymbol)}</Text>
              </View>
            </View>

            <View style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.text}>Debt paid down (Principal)</Text>
              <Text style={[ui.value, { color: '#73D9C6' }]}>
                {formatCurrency(summary.debtPaidDown, currencySymbol)}
              </Text>
            </View>

            <View style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.text}>Total payments made</Text>
              <Text style={ui.value}>
                {formatCurrency(summary.totalPayments, currencySymbol)}
              </Text>
            </View>

            <View style={[ui.row, { gap: 8, marginTop: 8 }]}>
              <View
                style={{
                  flex: 1,
                  backgroundColor: '#292D2B',
                  borderRadius: 12,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: '#353A37',
                  gap: 4,
                }}
              >
                <Text style={ui.small}>Interest & fees recorded</Text>
                <Text style={[ui.value, { color: '#E3A088' }]}>
                  {formatCurrency(summary.totalInterestAndFees, currencySymbol)}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  backgroundColor: '#292D2B',
                  borderRadius: 12,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: '#353A37',
                  gap: 4,
                }}
              >
                <Text style={ui.small}>Net balance change</Text>
                <Text style={[ui.value, { color: summary.netBalanceChange <= 0 ? '#73D9C6' : '#E3A088' }]}>
                  {`${summary.netBalanceChange > 0 ? '+' : ''}${formatCurrency(summary.netBalanceChange, currencySymbol)}`}
                </Text>
              </View>
            </View>
          </Card>

          <Card>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.heading}>Activity by account</Text>
              <View style={ui.badge}>
                <Text style={ui.badgeText}>{`${debts.length} ACCOUNTS`}</Text>
              </View>
            </View>

            {accountActivities.length > 0 ? (
              accountActivities.map(item => (
                <View key={item.accountId} style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
                  <View style={[ui.row, { flex: 1, gap: 8 }]}>
                    <View style={ui.iconCircle}>
                      <Text style={ui.buttonText}>{item.accountName.slice(0, 2).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={ui.heading}>{item.accountName}</Text>
                      <Text style={ui.small}>
                        {item.transactionCount > 0
                          ? `${item.transactionCount} entries · ${formatCurrency(item.payments, currencySymbol)} paid`
                          : `${item.category} · No activity this period`}
                      </Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={ui.value}>{formatCurrency(item.balance, currencySymbol)}</Text>
                    <Text style={[ui.small, { color: item.netChange <= 0 ? '#73D9C6' : '#E3A088' }]}>
                      {item.netChange !== 0
                        ? `${item.netChange > 0 ? '+' : ''}${formatCurrency(item.netChange, currencySymbol)} net`
                        : '—'}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={ui.text}>No accounts listed.</Text>
            )}
          </Card>
        </>
      ) : tab === 'Utilization' ? (
        <>
          <Card>
            <View style={ui.row}>
              <View style={{ flex: 1 }}>
                {[
                  ['Tracked credit limits', formatCurrency(utilization.totalLimit, currencySymbol)],
                  ['Used credit on tracked cards', formatCurrency(utilization.totalUsed, currencySymbol)],
                  ['Cards with limits', `${utilization.trackedCardsCount} / ${utilization.totalCardsCount}`],
                ].map(([k, v], idx) => (
                  <View key={k} style={idx > 0 ? ui.divider : { gap: 4 }}>
                    <Text style={ui.small}>{k}</Text>
                    <Text style={ui.heading}>{utilization.trackedCardsCount ? v : 'Unavailable'}</Text>
                  </View>
                ))}
              </View>
              <Ring
                percent={utilization.utilizationPercent}
                label={utilization.statusBand.toUpperCase()}
              />
            </View>
            <View style={[ui.badge, { alignSelf: 'flex-start', marginTop: 8, backgroundColor: utilization.statusBand === 'high' ? '#3D2520' : utilization.statusBand === 'moderate' ? '#3A2E1C' : '#1E2C28' }]}>
              <Text style={[ui.badgeText, { color: utilization.statusBand === 'high' ? '#FF7A59' : utilization.statusBand === 'moderate' ? '#E5A93C' : '#81DFD2' }]}>
                {utilization.statusBand === 'unavailable' ? 'ADD LIMITS' : utilization.statusBand === 'high' ? 'HIGH' : utilization.statusBand === 'moderate' ? 'WATCH' : 'GOOD'}
              </Text>
            </View>
          </Card>

          <View style={ui.row}>
            <View style={{ flex: 1 }}>
              <Card>
                <Text style={ui.small}>Available credit</Text>
                <Text style={ui.heading}>
                  {utilization.trackedCardsCount
                    ? formatCurrency(utilization.availableCredit, currencySymbol)
                    : 'Unavailable'}
                </Text>
              </Card>
            </View>
            <View style={{ flex: 1 }}>
              <Card>
                <Text style={ui.small}>Healthy ceiling (30%)</Text>
                <Text style={ui.heading}>
                  {utilization.totalLimit > 0
                    ? formatCurrency(utilization.totalLimit * 0.3, currencySymbol)
                    : '—'}
                </Text>
              </Card>
            </View>
          </View>

          <Card>
            <Text style={ui.heading}>Cards to review</Text>
            {debts.filter(d => d.category === 'Credit card').length > 0 ? (
              debts
                .filter(d => d.category === 'Credit card')
                .map(d => {
                  const cardUtil = d.creditLimit && d.creditLimit > 0
                    ? (Math.max(0, d.balance) / d.creditLimit) * 100
                    : 0;
                  const isHigh = d.creditLimit != null && cardUtil > 50;
                  const isModerate = d.creditLimit != null && cardUtil > 30 && cardUtil <= 50;
                  const targetPaydown = d.creditLimit != null ? Math.max(0, Math.max(0, d.balance) - d.creditLimit * 0.3) : null;
                  return (
                    <Pressable
                      key={d.id}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${d.name} details`}
                      onPress={() => onSelectDebt?.(d.id)}
                      style={ui.divider}
                    >
                      <View style={[ui.row, { justifyContent: 'space-between' }]}>
                        <View style={[ui.row, { flex: 1, gap: 8 }]}>
                          <View style={ui.iconCircle}>
                            <AppIcon name="creditCard" size={18} color="#81DFD2" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={ui.heading}>{d.name}</Text>
                            <Text style={ui.small}>
                              {d.creditLimit
                                ? `${formatCurrency(d.balance, currencySymbol)} of ${formatCurrency(
                                    d.creditLimit,
                                    currencySymbol,
                                  )} limit`
                                : 'Add a credit limit on Debt tab'}
                            </Text>
                          </View>
                        </View>
                        <View style={[ui.row, { gap: 8, alignItems: 'center' }]}>
                          <View
                            style={[
                              ui.badge,
                              {
                                backgroundColor: isHigh
                                  ? '#3D2520'
                                  : isModerate
                                    ? '#3A2E1C'
                                    : '#1E2C28',
                              },
                            ]}
                          >
                            <Text
                              style={[
                                ui.badgeText,
                                {
                                  color: isHigh
                                    ? '#FF7A59'
                                    : isModerate
                                      ? '#E5A93C'
                                      : '#81DFD2',
                                },
                              ]}
                            >
                              {d.creditLimit ? (isHigh ? 'High' : isModerate ? 'Watch' : 'Good') : '—'}
                            </Text>
                          </View>
                          <AppIcon name="chevronRight" size={16} color="#81DFD2" />
                        </View>
                      </View>
                      <Bar percent={cardUtil} />
                      <View style={[ui.row, { justifyContent: 'space-between', marginTop: 5 }]}>
                        <Text style={ui.small}>{d.creditLimit ? `${cardUtil.toFixed(1)}% used` : 'Utilization unavailable'}</Text>
                        {targetPaydown != null ? (
                          <Text style={[ui.small, { color: targetPaydown > 0 ? '#81DFD2' : '#73D9C6', textAlign: 'right', flex: 1 }]}>
                            {targetPaydown > 0 ? `Pay ${formatCurrency(targetPaydown, currencySymbol)} to reach 30%` : 'At 30% target'}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })
            ) : (
              <Text style={ui.text}>No credit card accounts entered yet.</Text>
            )}
          </Card>
        </>
      ) : (
        <>
          <Card>
            <View style={ui.row}>
              {[
                ['Completed', completedCount, '#73D9C6'],
                ['In Progress', inProgressCount, '#81DFD2'],
                ['Locked', lockedCount, '#6E7571'],
              ].map(([label, count, color]) => (
                <View key={String(label)} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <Text style={[ui.heading, { color: String(color) }]}>{String(count)}</Text>
                  <Text style={ui.small}>{String(label)}</Text>
                </View>
              ))}
            </View>
          </Card>

          {nextUnlock ? (
            <Card>
              <View style={[ui.row, { gap: 6 }]}>
                <AppIcon name="flag" size={15} color="#81DFD2" />
                <Text style={ui.value}>NEXT UNLOCK</Text>
              </View>
              <Text style={ui.heading}>{nextUnlock.title}</Text>
              <View style={{ marginTop: 8 }}>
                <View style={[ui.row, { justifyContent: 'space-between', marginBottom: 4 }]}>
                  <Text style={ui.small}>Progress</Text>
                  <Text style={[ui.small, { color: '#81DFD2', fontWeight: 'bold' }]}>
                    {`${Math.round(nextUnlock.percent)}%`}
                  </Text>
                </View>
                <Bar percent={nextUnlock.percent} />
              </View>
            </Card>
          ) : null}

          {milestones.map(m => {
            const isCompleted = m.status === 'completed';
            const isInProgress = m.status === 'in_progress';
            return (
              <Card key={m.id}>
                <View style={[ui.row, { justifyContent: 'space-between' }]}>
                  <View style={[ui.row, { flex: 1, gap: 10 }]}>
                    <View
                      style={[
                        ui.iconCircle,
                        {
                          backgroundColor: isCompleted
                            ? '#1E2C28'
                            : isInProgress
                              ? '#292D2B'
                              : '#1F201F',
                        },
                      ]}
                    >
                      <AppIcon
                        name={isCompleted ? 'check' : 'flag'}
                        size={18}
                        color={isCompleted ? '#73D9C6' : isInProgress ? '#81DFD2' : '#6E7571'}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={ui.heading}>{m.title}</Text>
                      <Text style={ui.small}>{isCompleted ? (m.earnedDate ? `Earned ${m.earnedDate.slice(0, 7)}` : 'Achieved') : isInProgress ? `${Math.round(m.percent)}% complete` : 'Up next'}</Text>
                    </View>
                  </View>
                  <View
                    style={[
                      ui.badge,
                      {
                        backgroundColor: isCompleted
                          ? '#1E2C28'
                          : isInProgress
                            ? '#292D2B'
                            : '#1F201F',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        ui.badgeText,
                        {
                          color: isCompleted
                            ? '#73D9C6'
                            : isInProgress
                              ? '#81DFD2'
                              : '#6E7571',
                        },
                      ]}
                    >
                      {isCompleted ? 'EARNED' : isInProgress ? `${Math.round(m.percent)}%` : 'LOCKED'}
                    </Text>
                  </View>
                </View>
                {!isCompleted && isInProgress ? (
                  <View style={{ marginTop: 8 }}>
                    <Bar percent={m.percent} />
                  </View>
                ) : null}
              </Card>
            );
          })}
        </>
      )}
    </FinancialScreen>
  );
}
