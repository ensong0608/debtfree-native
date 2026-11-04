import { useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Bar, Card, categoryDebts, FinancialScreen, snapshot, ui } from '../components/FinancialScreen';
import { AppIcon } from '../components/AppIcon';
import { formatCurrency, type DebtItem, type PayoffPlanResult } from '../onboarding-domain';

const filters = ['Cards & Loans', 'Home & Auto', 'All Debts'] as const;
const sorts = ['Name', 'Balance', 'APR', 'Payoff'] as const;

export function DebtScreen({
  debts,
  plan,
  currencySymbol,
  editor,
  error,
  onAdd,
  onEdit,
  onRemove,
  onSettings,
}: {
  debts: DebtItem[];
  plan: PayoffPlanResult;
  currencySymbol: string;
  editor: ReactNode;
  error: string;
  onAdd: () => void;
  onEdit: (item: DebtItem) => void;
  onRemove: (item: DebtItem) => void;
  onSettings: () => void;
}) {
  const [filter, setFilter] = useState<string>(filters[0]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(0);

  const scoped = categoryDebts(debts, filter);
  const stats = snapshot(scoped);

  const visible = scoped
    .filter(d => d.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      sort === 0
        ? a.name.localeCompare(b.name)
        : sort === 1
          ? b.balance - a.balance
          : sort === 2
            ? b.apr - a.apr
            : (plan.payoffOrder.find(p => p.id === a.id)?.monthsToPayoff ?? Infinity) -
              (plan.payoffOrder.find(p => p.id === b.id)?.monthsToPayoff ?? Infinity),
    );

  return (
    <FinancialScreen
      title="Debt"
      segments={filters}
      selected={filter}
      onSelect={setFilter}
      onSettings={onSettings}
      onAdd={onAdd}
      addLabel="Add debt account"
    >
      <Card>
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <View>
            <Text style={ui.small}>{filter}</Text>
            <Text style={ui.title}>{formatCurrency(stats.balance, currencySymbol)}</Text>
          </View>
          <View style={[ui.badge, ui.row, { gap: 4 }]}>
            <AppIcon name="trendDown" size={14} color="#81DFD2" />
            <Text style={ui.badgeText}>{`${Math.round(stats.percent)}% snapshot`}</Text>
          </View>
        </View>
      </Card>

      <View style={ui.row}>
        <View style={ui.inputWrap}>
          <AppIcon name="search" size={16} color="#AAB3AD" />
          <TextInput
            accessibilityLabel="Search debts"
            placeholder="Search debts"
            placeholderTextColor="#AAB3AD"
            value={query}
            onChangeText={setQuery}
            style={{ color: '#F9F9F6', flex: 1, minHeight: 40 }}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sort debts by ${sorts[sort]}; change sort`}
          onPress={() => setSort((sort + 1) % sorts.length)}
          style={[ui.button, ui.row, { gap: 6 }]}
        >
          <AppIcon name="sort" size={15} color="#81DFD2" />
          <Text style={ui.buttonText}>{sorts[sort]}</Text>
          <AppIcon name="chevronDown" size={13} color="#81DFD2" />
        </Pressable>
      </View>

      {editor}
      {!!error && !editor && (
        <Text accessibilityRole="alert" style={ui.text}>
          {error}
        </Text>
      )}
      {visible.length === 0 && (
        <Card>
          <Text style={ui.heading}>No accounts match this selection</Text>
          <Text style={ui.text}>
            Accounts are entered manually. Tap + to add a debt account to your plan.
          </Text>
        </Card>
      )}

      {visible.map(item => {
        const projection = plan.payoffOrder.find(p => p.id === item.id);
        const p = snapshot([item]).percent;
        const iconName =
          item.category === 'Mortgage'
            ? 'homeLoan'
            : item.category === 'Auto loan'
              ? 'auto'
              : 'creditCard';

        return (
          <Card key={item.id}>
            <View style={ui.row}>
              <View style={ui.iconCircle}>
                <AppIcon name={iconName} color="#81DFD2" size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ui.heading}>{item.name}</Text>
                <Text style={ui.small}>
                  {`${item.category} · ${item.apr}% APR${
                    item.balance === 0 ? ' · Zero balance' : ''
                  }`}
                </Text>
              </View>
              <View style={[ui.row, { gap: 6 }]}>
                <Text style={ui.value}>{formatCurrency(item.balance, currencySymbol)}</Text>
                <AppIcon name="chevronRight" size={16} color="#AAB3AD" />
              </View>
            </View>
            <Bar percent={p} />
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.small}>{`${Math.round(p)}% reduced (snapshot)`}</Text>
              <View style={ui.badge}>
                <Text style={ui.badgeText}>
                  {projection?.projectedPayoffLabel ?? 'No active projection'}
                </Text>
              </View>
            </View>
            <View style={[ui.divider, ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.small}>
                {`Min: ${formatCurrency(item.minimumPayment, currencySymbol)}/mo · Plan: ${
                  projection ? formatCurrency(projection.firstMonthPayment, currencySymbol) : '—'
                }/mo`}
              </Text>
              <View style={ui.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${item.name}`}
                  onPress={() => onEdit(item)}
                  style={ui.button}
                >
                  <Text style={ui.buttonText}>Edit</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.name}`}
                  onPress={() => onRemove(item)}
                  style={ui.button}
                >
                  <Text style={ui.buttonText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          </Card>
        );
      })}
    </FinancialScreen>
  );
}

