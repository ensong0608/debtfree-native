import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppIcon } from '../components/AppIcon';
import {
  Bar,
  Card,
  categories,
  categoryDebts,
  FinancialScreen,
  Gauge,
  Ring,
  Segments,
  SnapshotCard,
  snapshot,
  ui,
} from '../components/FinancialScreen';
import { formatCurrency, type DebtItem } from '../onboarding-domain';

export function ProgressScreen({
  debts,
  currencySymbol,
  onSettings,
}: {
  debts: DebtItem[];
  currencySymbol: string;
  onSettings: () => void;
}) {
  const [tab, setTab] = useState('Overview');
  const [period, setPeriod] = useState('Current month');
  const [category, setCategory] = useState(0);
  const cards = debts.filter(d => d.category === 'Credit card');
  const tracked = cards.filter(d => d.creditLimit !== null && d.creditLimit > 0);
  const limit = tracked.reduce((s, d) => s + (d.creditLimit ?? 0), 0);
  const used = tracked.reduce((s, d) => s + d.balance, 0);
  const utilization = limit ? (used / limit) * 100 : 0;
  const stats = snapshot(categoryDebts(debts, categories[category]));

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
      {tab === 'Overview' ? (
        <>
          <SnapshotCard debts={debts} currencySymbol={currencySymbol} />
          <Card>
            <Text style={ui.heading}>{period} progress</Text>
            <Segments
              items={['Current month', 'Previous month', 'Lifetime']}
              selected={period}
              onSelect={setPeriod}
            />
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={[ui.badge, { alignSelf: 'flex-start' }]}>
                  <Text style={ui.badgeText}>UNAVAILABLE</Text>
                </View>
                <Text style={ui.heading}>No recorded activity yet</Text>
                <Text style={ui.text}>
                  Historical payment and balance events are not connected yet.
                </Text>
              </View>
              <Gauge />
            </View>
            {['Debt paid down', 'Payments made', 'Accounts paid off'].map(x => (
              <View
                key={x}
                style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}
              >
                <Text style={ui.text}>{x}</Text>
                <Text style={ui.value}>Unavailable</Text>
              </View>
            ))}
            <View style={ui.row}>
              {['Interest & fees recorded', 'Recorded balance change'].map(x => (
                <View
                  key={x}
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
                  <Text style={ui.small}>{x}</Text>
                  <Text style={ui.value}>Unavailable</Text>
                </View>
              ))}
            </View>
          </Card>

          <Card>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.heading}>Activity by account</Text>
              <View style={ui.badge}>
                <Text style={ui.badgeText}>{`${debts.length} accounts`}</Text>
              </View>
            </View>
            {debts.length ? (
              debts.map(d => (
                <View key={d.id} style={[ui.divider, ui.row]}>
                  <View style={ui.iconCircle}>
                    <Text style={ui.buttonText}>{d.name.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={ui.heading}>{d.name}</Text>
                    <Text style={ui.small}>{`${d.category} · No recorded activity`}</Text>
                  </View>
                  <Text style={ui.small}>—</Text>
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
                  ['Total limit', formatCurrency(limit, currencySymbol)],
                  ['Used credit', formatCurrency(used, currencySymbol)],
                  ['Available credit', formatCurrency(Math.max(0, limit - used), currencySymbol)],
                  ['Target utilization', '30%'],
                  [
                    'To reach 30%',
                    formatCurrency(Math.max(0, used - limit * 0.3), currencySymbol),
                  ],
                ].map(([k, v], idx) => (
                  <View key={k} style={idx > 0 ? ui.divider : { gap: 4 }}>
                    <Text style={ui.small}>{k}</Text>
                    <Text style={ui.heading}>{tracked.length ? v : 'Unavailable'}</Text>
                  </View>
                ))}
              </View>
              <Ring percent={utilization} label="utilization" />
            </View>
            <Text style={ui.small}>
              {tracked.length < cards.length
                ? 'Add credit limits on Debt tab for complete card coverage.'
                : 'Based on entered credit card balances and limits.'}
            </Text>
          </Card>

          <View style={ui.row}>
            <View style={{ flex: 1 }}>
              <Card>
                <Text style={ui.small}>Available credit</Text>
                <Text style={ui.heading}>
                  {tracked.length
                    ? formatCurrency(Math.max(0, limit - used), currencySymbol)
                    : 'Unavailable'}
                </Text>
              </Card>
            </View>
            <View style={{ flex: 1 }}>
              <Card>
                <Text style={ui.small}>Cards tracked</Text>
                <Text style={ui.heading}>{`${tracked.length} / ${cards.length}`}</Text>
              </Card>
            </View>
          </View>

          <Card>
            <Text style={ui.heading}>Cards to review</Text>
            {cards.length > 0 ? (
              cards.map(d => {
                const cardUtil = d.creditLimit ? (d.balance / d.creditLimit) * 100 : 0;
                return (
                  <View key={d.id} style={ui.divider}>
                    <View style={[ui.row, { justifyContent: 'space-between' }]}>
                      <View style={[ui.row, { flex: 1 }]}>
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
                                )} · 30% target`
                              : 'Add a credit limit on Debt tab'}
                          </Text>
                        </View>
                      </View>
                      <View style={ui.badge}>
                        <Text style={ui.badgeText}>
                          {d.creditLimit ? `${Math.round(cardUtil)}%` : 'No limit'}
                        </Text>
                      </View>
                    </View>
                    <Bar percent={cardUtil} />
                  </View>
                );
              })
            ) : (
              <Text style={ui.text}>No credit card accounts entered yet.</Text>
            )}
          </Card>
        </>
      ) : (
        <>
          <Text style={ui.heading}>Small wins add up to a debt-free you.</Text>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.small}>Debt category</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Select milestone category"
              style={ui.button}
              onPress={() => setCategory((category + 1) % categories.length)}
            >
              <Text style={ui.buttonText}>{categories[category]}</Text>
              <AppIcon name="chevronDown" size={12} color="#AAB3AD" />
            </Pressable>
          </View>

          <Card>
            <View style={ui.row}>
              {['Completed', 'In Progress', 'Up Next'].map(x => (
                <View key={x} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <Text style={ui.heading}>—</Text>
                  <Text style={ui.small}>{x}</Text>
                </View>
              ))}
            </View>
            <Text style={[ui.small, { textAlign: 'center' }]}>
              Milestone event history is unavailable.
            </Text>
          </Card>

          <Card>
            <View style={[ui.row, { gap: 6 }]}>
              <AppIcon name="flag" size={15} color="#81DFD2" />
              <Text style={ui.value}>NEXT UNLOCK</Text>
            </View>
            <Text style={ui.heading}>Progress milestones</Text>
            <Bar percent={stats.percent} />
            <Text style={ui.small}>
              {`${Math.round(stats.percent)}% balance snapshot · not verified payment history`}
            </Text>
          </Card>

          {[
            ['First payment recorded', 'Requires connected payment history'],
            ['First $1,000 eliminated', 'Requires recorded balance history'],
            ['First debt paid off', 'Requires verified payoff event history'],
            ['25% complete', `${Math.round(stats.percent)}% in current balance snapshot`],
            ['50% complete', `${Math.round(stats.percent)}% in current balance snapshot`],
          ].map(([title, sub], index) => (
            <Card key={title}>
              <View style={ui.row}>
                <View style={ui.iconCircle}>
                  <AppIcon name={index < 3 ? 'flag' : 'check'} size={18} color="#81DFD2" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ui.heading}>{title}</Text>
                  <Text style={ui.text}>{`Unavailable · ${sub}`}</Text>
                </View>
              </View>
            </Card>
          ))}
        </>
      )}
    </FinancialScreen>
  );
}
