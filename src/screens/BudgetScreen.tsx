import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppIcon, type AppIconName } from '../components/AppIcon';
import { Bar, Card, FinancialScreen, ui } from '../components/FinancialScreen';
import {
  calculateTotalMonthlyIncome,
  formatCurrency,
  normalizeMonthlyIncome,
  PAY_FREQUENCY_OPTIONS,
  type PayoffPlanResult,
  type PayoffStrategy,
  type UserOnboardingData,
} from '../onboarding-domain';

const SUMMARY_CATEGORIES: { label: string; icon: AppIconName }[] = [
  { label: 'Housing', icon: 'homeLoan' },
  { label: 'Insurance', icon: 'info' },
  { label: 'Subscriptions', icon: 'calendar' },
  { label: 'Transportation', icon: 'auto' },
  { label: 'One-time spending', icon: 'transactions' },
  { label: 'Debt payments', icon: 'debt' },
];

export function BudgetScreen({
  data,
  plan,
  currencySymbol,
  onEditIncome,
  onStrategy,
  onExtra,
  onSettings,
  error: saveError,
  initialSection,
}: {
  data: UserOnboardingData;
  plan: PayoffPlanResult;
  currencySymbol: string;
  onEditIncome: () => void;
  onStrategy: (strategy: PayoffStrategy) => void;
  onExtra: (amount: number) => void;
  onSettings: () => void;
  error: string;
  initialSection: string;
}) {
  const [tab, setTab] = useState(initialSection);
  const [offset, setOffset] = useState(0);
  const [extra, setExtra] = useState(String(data.extraMonthlyPayment));
  const [error, setError] = useState('');
  const [showExpenseNotice, setShowExpenseNotice] = useState(false);

  const incomes = [
    {
      id: 'primary',
      name: 'Primary income',
      amount: data.primaryIncomeAmount,
      frequency: data.primaryPayFrequency,
    },
    ...data.additionalIncomes,
  ];
  const income = calculateTotalMonthlyIncome(
    data.primaryIncomeAmount,
    data.primaryPayFrequency,
    data.additionalIncomes,
  );
  const month = new Date();
  month.setDate(1);
  month.setMonth(month.getMonth() + offset);
  const allocationPercent = income > 0 ? (plan.monthlyTotalPayment / income) * 100 : 0;

  return (
    <FinancialScreen
      title={tab === 'Strategy' ? 'Payoff strategy' : tab === 'Upcoming' ? 'Upcoming' : 'Budget'}
      segments={['Budget', 'Upcoming', 'Strategy']}
      selected={tab}
      onSelect={setTab}
      onSettings={onSettings}
      onAdd={tab === 'Budget' ? () => setShowExpenseNotice(prev => !prev) : undefined}
      addLabel="Add budget item"
    >
      {!!saveError && (
        <Text accessibilityRole="alert" style={ui.text}>
          {saveError}
        </Text>
      )}

      {tab === 'Budget' && showExpenseNotice ? (
        <Card>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.heading}>Spending entry unavailable</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss notice"
              onPress={() => setShowExpenseNotice(false)}
            >
              <Text style={ui.buttonText}>Dismiss</Text>
            </Pressable>
          </View>
          <Text style={ui.text}>
            Recurring and one-time expense entry is not connected yet. You can edit your household
            income or adjust your debt payoff plan now.
          </Text>
        </Card>
      ) : null}

      {tab === 'Budget' ? (
        <>
          <Card>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                onPress={() => setOffset(offset - 1)}
                style={{ padding: 6 }}
              >
                <AppIcon name="chevronLeft" size={18} color="#81DFD2" />
              </Pressable>
              <Text style={ui.heading}>
                {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next month"
                onPress={() => setOffset(offset + 1)}
                style={{ padding: 6 }}
              >
                <AppIcon name="chevronRight" size={18} color="#81DFD2" />
              </Pressable>
            </View>
          </Card>

          <Card>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <View>
                <Text style={ui.small}>Income · monthly equivalent</Text>
                <Text style={ui.title}>{formatCurrency(income, currencySymbol)}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit income"
                style={ui.button}
                onPress={onEditIncome}
              >
                <Text style={ui.buttonText}>Edit</Text>
              </Pressable>
            </View>
            <Bar percent={allocationPercent} />
            <View style={[ui.row, { alignItems: 'stretch' }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={ui.small}>Budget (Debt Plan)</Text>
                <Text style={ui.heading}>
                  {formatCurrency(plan.monthlyTotalPayment, currencySymbol)}
                </Text>
              </View>
              <View style={{ width: 1, backgroundColor: '#353A37' }} />
              <View style={{ flex: 1, paddingLeft: 8, gap: 2 }}>
                <Text style={ui.small}>Remaining</Text>
                <Text style={ui.value}>
                  {formatCurrency(income - plan.monthlyTotalPayment, currencySymbol)}
                </Text>
              </View>
            </View>
            <Text style={ui.small}>
              Income minus planned debt payments only; recurring and one-time spending are
              unavailable. Includes {formatCurrency(plan.monthlyTotalPayment, currencySymbol)}{' '}
              planned for debt payments.
            </Text>
          </Card>

          <Card>
            <Text style={ui.heading}>Income sources</Text>
            {incomes.map(i => (
              <View key={i.id} style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.text}>{i.name}</Text>
                  <Text style={ui.small}>
                    {`${formatCurrency(i.amount, currencySymbol)} · ${
                      PAY_FREQUENCY_OPTIONS.find(o => o.value === i.frequency)?.label
                    }`}
                  </Text>
                </View>
                <Text style={ui.value}>
                  {formatCurrency(normalizeMonthlyIncome(i.amount, i.frequency), currencySymbol)}
                  /mo
                </Text>
              </View>
            ))}
          </Card>

          <Card>
            <Text style={ui.heading}>Budget Summary</Text>
            {SUMMARY_CATEGORIES.map(({ label, icon }) => {
              const isDebt = label === 'Debt payments';
              return (
                <View key={label} style={ui.divider}>
                  <View style={[ui.row, { justifyContent: 'space-between' }]}>
                    <View style={ui.row}>
                      <View style={ui.iconCircle}>
                        <AppIcon name={icon} size={18} color="#81DFD2" />
                      </View>
                      <View>
                        <Text style={ui.heading}>{label}</Text>
                        <Text style={ui.small}>
                          {isDebt ? 'Projected from active payoff plan' : 'Source not connected'}
                        </Text>
                      </View>
                    </View>
                    <Text style={isDebt ? ui.value : ui.small}>
                      {isDebt
                        ? formatCurrency(plan.monthlyTotalPayment, currencySymbol)
                        : 'Unavailable'}
                    </Text>
                  </View>
                  {isDebt ? <Bar percent={allocationPercent} /> : null}
                </View>
              );
            })}
          </Card>
        </>
      ) : tab === 'Upcoming' ? (
        <Card>
          <Text style={ui.heading}>Upcoming bills</Text>
          <Text style={ui.text}>
            Full dated bill schedules are unavailable. Any items below are manual due-day reminders
            from your debt accounts, not verified bills.
          </Text>
          {data.debts.filter(d => d.dueDay).length > 0 ? (
            data.debts
              .filter(d => d.dueDay)
              .map(d => (
                <View key={d.id} style={[ui.divider, ui.row]}>
                  <View style={ui.iconCircle}>
                    <AppIcon
                      name={
                        d.category === 'Mortgage'
                          ? 'homeLoan'
                          : d.category === 'Auto loan'
                            ? 'auto'
                            : 'creditCard'
                      }
                      size={18}
                      color="#81DFD2"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={ui.heading}>{d.name}</Text>
                    <Text style={ui.small}>{`Due day ${d.dueDay} · Manual reminder`}</Text>
                  </View>
                  <Text style={ui.value}>
                    {formatCurrency(d.minimumPayment, currencySymbol)}
                  </Text>
                </View>
              ))
          ) : (
            <Text style={ui.small}>No due days entered on your debt accounts yet.</Text>
          )}
        </Card>
      ) : (
        <>
          <Card>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.heading}>Extra payment</Text>
              <View style={ui.badge}>
                <Text style={ui.badgeText}>ALL ACTIVE DEBTS</Text>
              </View>
            </View>
            <Text style={ui.small}>
              Monthly extra amount applied on top of minimum payments:
            </Text>
            <View style={ui.row}>
              <TextInput
                accessibilityLabel="Extra monthly payment"
                keyboardType="decimal-pad"
                value={extra}
                onChangeText={setExtra}
                style={ui.input}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save extra monthly payment"
                style={ui.button}
                onPress={() => {
                  const n = Number(extra);
                  if (!extra.trim() || !Number.isFinite(n) || n < 0) {
                    setError('Enter a valid non-negative amount.');
                    return;
                  }
                  setError('');
                  onExtra(n);
                }}
              >
                <Text style={ui.buttonText}>Save</Text>
              </Pressable>
            </View>
            {!!error && (
              <Text accessibilityRole="alert" style={ui.text}>
                {error}
              </Text>
            )}
            <View style={ui.row}>
              {(['avalanche', 'snowball'] as const).map(s => (
                <Pressable
                  key={s}
                  accessibilityRole="button"
                  accessibilityState={{ selected: data.strategy === s }}
                  onPress={() => onStrategy(s)}
                  style={[
                    ui.button,
                    { flex: 1, flexDirection: 'column', alignItems: 'flex-start', padding: 12 },
                    data.strategy === s && ui.selected,
                  ]}
                >
                  <View style={[ui.row, { gap: 6 }]}>
                    <AppIcon name={s} size={16} color="#81DFD2" />
                    <Text style={ui.buttonText}>
                      {s === 'avalanche' ? 'Avalanche' : 'Snowball'}
                    </Text>
                  </View>
                  <Text style={ui.small}>
                    {s === 'avalanche' ? 'Highest interest first' : 'Smallest balance first'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Card>

          <Card>
            <Text style={ui.heading}>Extra-payment priority</Text>
            {plan.payoffOrder.length > 0 ? (
              plan.payoffOrder.map((d, i) => (
                <View key={d.id} style={[ui.divider, ui.row]}>
                  <View style={ui.badge}>
                    <Text style={ui.badgeText}>#{i + 1}</Text>
                  </View>
                  <View style={ui.iconCircle}>
                    <AppIcon
                      name={
                        d.category === 'Mortgage'
                          ? 'homeLoan'
                          : d.category === 'Auto loan'
                            ? 'auto'
                            : 'creditCard'
                      }
                      size={18}
                      color="#81DFD2"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={ui.heading}>{d.name}</Text>
                    <Text style={ui.small}>{`${d.apr}% APR`}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={ui.value}>
                      {formatCurrency(d.firstMonthPayment, currencySymbol)}/mo
                    </Text>
                    <View style={ui.badge}>
                      <Text style={ui.badgeText}>{d.projectedPayoffLabel}</Text>
                    </View>
                  </View>
                </View>
              ))
            ) : (
              <Text style={ui.text}>No active debt balances to prioritize.</Text>
            )}
          </Card>
        </>
      )}
    </FinancialScreen>
  );
}
