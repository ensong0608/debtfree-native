import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppIcon } from '../components/AppIcon';
import { Card, FinancialScreen, ui } from '../components/FinancialScreen';
import type { DebtItem } from '../onboarding-domain';

export function TransactionsScreen({
  debts,
  onSettings,
}: {
  debts: DebtItem[];
  onSettings: () => void;
}) {
  const [tab, setTab] = useState('History');
  const [account, setAccount] = useState(0);
  const [period, setPeriod] = useState(0);
  const [type, setType] = useState(0);
  const [sort, setSort] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddNotice, setShowAddNotice] = useState(false);
  const accounts = ['All accounts', ...debts.map(d => d.name)];

  return (
    <FinancialScreen
      title="Transactions"
      segments={['History', 'Scheduled']}
      selected={tab}
      onSelect={setTab}
      onSettings={onSettings}
      onAdd={() => setShowAddNotice(prev => !prev)}
      addLabel="Add transaction"
    >
      {showAddNotice ? (
        <Card>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.heading}>Transaction entry unavailable</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss notice"
              onPress={() => setShowAddNotice(false)}
            >
              <Text style={ui.buttonText}>Dismiss</Text>
            </Pressable>
          </View>
          <Text style={ui.text}>
            Manual transaction entry and bank-sync imports are not connected yet.
          </Text>
        </Card>
      ) : null}

      {tab === 'Scheduled' ? (
        <Card>
          <Text style={ui.heading}>No scheduled payments recorded yet</Text>
          <Text style={ui.text}>
            Scheduled payment records for household checking, savings, and debt accounts are not
            connected yet.
          </Text>
        </Card>
      ) : (
        <>
          <View style={ui.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Select period"
              style={[ui.button, { flex: 1, justifyContent: 'space-between' }]}
              onPress={() => setPeriod((period + 1) % 2)}
            >
              <View style={[ui.row, { gap: 6 }]}>
                <AppIcon name="calendar" size={14} color="#81DFD2" />
                <Text style={ui.buttonText}>{period ? 'Previous month' : 'Current month'}</Text>
              </View>
              <AppIcon name="chevronDown" size={12} color="#AAB3AD" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Select account filter"
              style={[ui.button, { flex: 1, justifyContent: 'space-between' }]}
              onPress={() => setAccount((account + 1) % accounts.length)}
            >
              <Text numberOfLines={1} style={[ui.buttonText, { flex: 1 }]}>
                {accounts[account]}
              </Text>
              <AppIcon name="chevronDown" size={12} color="#AAB3AD" />
            </Pressable>
          </View>

          <Text style={ui.small}>
            Totals for selected period and account · before search and type filters. Household
            checking and savings coverage is not connected.
          </Text>

          <View style={ui.row}>
            {(
              [
                ['Payments', 'trendDown', '#81DFD2'],
                ['Interest & fees', 'brandRise', '#E3A088'],
                ['Adjustments', 'sort', '#AAB3AD'],
              ] as const
            ).map(([label, icon, color]) => (
              <View
                key={label}
                style={{
                  flex: 1,
                  backgroundColor: '#262927',
                  borderRadius: 12,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: '#353A37',
                  gap: 4,
                }}
              >
                <View style={[ui.row, { gap: 5 }]}>
                  <AppIcon name={icon} size={13} color={color} />
                  <Text numberOfLines={1} style={ui.small}>
                    {label}
                  </Text>
                </View>
                <Text style={ui.heading}>—</Text>
                <Text style={ui.small}>Unavailable</Text>
              </View>
            ))}
          </View>

          <Card>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <View style={[ui.row, { gap: 6 }]}>
                <Text style={ui.text}>Net balance change</Text>
                <AppIcon name="info" size={15} color="#AAB3AD" />
              </View>
              <Text style={ui.value}>Unavailable</Text>
            </View>
          </Card>

          <View style={ui.row}>
            <View style={ui.inputWrap}>
              <AppIcon name="search" size={16} color="#AAB3AD" />
              <TextInput
                accessibilityLabel="Search transactions"
                placeholder="Search"
                placeholderTextColor="#AAB3AD"
                value={search}
                onChangeText={setSearch}
                style={[ui.input, { borderWidth: 0, paddingHorizontal: 0, paddingVertical: 8 }]}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter by transaction type"
              style={ui.button}
              onPress={() => setType((type + 1) % 3)}
            >
              <Text style={ui.buttonText}>{['Type', 'Payments', 'Adjustments'][type]}</Text>
              <AppIcon name="chevronDown" size={12} color="#AAB3AD" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change sort order"
              style={ui.button}
              onPress={() => setSort(!sort)}
            >
              <AppIcon name="sort" size={14} color="#81DFD2" />
              <Text style={ui.buttonText}>{sort ? 'Oldest' : 'Newest'}</Text>
            </Pressable>
          </View>

          <Card>
            <Text style={ui.heading}>No recorded activity yet</Text>
            <Text style={ui.text}>
              Household transaction records for checking, savings, everyday purchases, transfers,
              and debt payments are not connected yet.
            </Text>
          </Card>
        </>
      )}
    </FinancialScreen>
  );
}
