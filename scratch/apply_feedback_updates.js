const fs = require('fs');

console.log('--- Applying User Feedback Updates ---');

// ========================================================
// 1. BudgetScreen.tsx: Restore Distinct Category Colors
// ========================================================
let bs = fs.readFileSync('src/screens/BudgetScreen.tsx', 'utf8');

// Segments on BudgetScreen: ['Budget', 'Upcoming']
bs = bs.replace(
  `segments={['Budget', 'Upcoming', 'Scheduled']}\n      selected={tab}\n      onSelect={value => value === 'Scheduled' ? onOpenScheduled() : setTab(value)}`,
  `segments={['Budget', 'Upcoming']}\n      selected={tab}\n      onSelect={value => setTab(value)}`
);

// Distinct category colors:
const oldCatLogic = `              // Dynamic Threshold Colors from Visual Audit HTML:
              // >=85% = Coral Warning (#F08B78)
              // 70-84% = Amber Caution (#F5C563)
              // <70% = Mint Healthy (#76DCB9)
              const catColor =
                item.percentOfIncome >= 85
                  ? '#F08B78'
                  : item.percentOfIncome >= 70
                    ? '#F5C563'
                    : '#76DCB9';`;

const newCatLogic = `              const key = item.categoryKey.toLowerCase();
              const label = item.label.toLowerCase();
              const isDebt = key === 'debt' || label.includes('debt');
              const isPurchases = key === 'purchases' || label.includes('single purchase') || label.includes('purchase');
              const isHousing = key === 'housing' || label.includes('housing') || label.includes('rent') || label.includes('mortgage');
              const isTransport = key === 'transportation' || key === 'auto' || label.includes('transport') || label.includes('auto') || label.includes('car');
              const isUtilities = key === 'utilities' || label.includes('utilit') || label.includes('electric') || label.includes('water');
              const isSubscription = key === 'subscription' || label.includes('subscri') || label.includes('streaming');
              const isInsurance = key === 'insurance' || label.includes('insur');

              const icon: AppIconName =
                isDebt
                  ? 'debt'
                  : isPurchases
                    ? 'transactions'
                  : isHousing
                    ? 'homeLoan'
                    : isTransport
                      ? 'auto'
                      : isUtilities
                        ? 'auto'
                        : isSubscription
                          ? 'calendar'
                          : isInsurance
                            ? 'info'
                            : 'transactions';

              // Distinct category palette:
              const catColor =
                isDebt
                  ? '#76DCB9' // Brand Mint
                  : isHousing
                    ? '#86E3B8' // Positive Emerald / Soft Green
                    : isTransport
                      ? '#F5C563' // Warm Amber
                      : isUtilities
                        ? '#4DD0E1' // Aqua / Electric Cyan
                        : isSubscription
                          ? '#A78BFA' // Soft Lavender / Violet
                          : isInsurance
                            ? '#BA68C8' // Muted Orchid
                            : isPurchases
                              ? '#F08B78' // Warm Coral
                              : '#38BDF8'; // Steel / Sky Blue`;

// Replace icon declaration and catColor
const oldIconBlock = `              const isDebt = item.categoryKey === 'debt';
              const isPurchases = item.categoryKey === 'purchases';
              const icon: AppIconName =
                isDebt
                  ? 'debt'
                  : isPurchases
                    ? 'transactions'
                  : item.categoryKey === 'housing'
                    ? 'homeLoan'
                    : item.categoryKey === 'utilities'
                      ? 'auto'
                      : item.categoryKey === 'subscription'
                        ? 'calendar'
                        : item.categoryKey === 'insurance'
                          ? 'info'
                          : 'transactions';

${oldCatLogic}`;

if (bs.includes(oldIconBlock)) {
  bs = bs.replace(oldIconBlock, newCatLogic);
  console.log('Replaced category logic in BudgetScreen.tsx');
} else {
  console.log('Warning: could not find exact oldIconBlock in BudgetScreen.tsx');
}

fs.writeFileSync('src/screens/BudgetScreen.tsx', bs, 'utf8');


// ========================================================
// 2. TransactionsScreen.tsx: Scheduled & Upcoming on Transactions
// ========================================================
let ts = fs.readFileSync('src/screens/TransactionsScreen.tsx', 'utf8');

ts = ts.replace(
  `title={budgetScheduled ? 'Budget' : 'Transactions'}\n      segments={budgetScheduled ? ['Budget', 'Upcoming', 'Scheduled'] : ['History']}\n      selected={tab}\n      onSelect={nextTab => {\n        if (budgetScheduled) { onBudgetSection?.(nextTab); return; }\n        setTab(nextTab);\n        if (nextTab !== 'History') setShowAddForm(false);\n      }}`,
  `title=\"Transactions\"\n      segments={['History', 'Upcoming', 'Scheduled']}\n      selected={tab}\n      onSelect={nextTab => {\n        setTab(nextTab);\n        if (nextTab !== 'History') setShowAddForm(false);\n      }}`
);

fs.writeFileSync('src/screens/TransactionsScreen.tsx', ts, 'utf8');
console.log('Updated TransactionsScreen.tsx');


// ========================================================
// 3. DebtScreen.tsx: Scheduled on Debt Tab
// ========================================================
let ds = fs.readFileSync('src/screens/DebtScreen.tsx', 'utf8');

// Imports in DebtScreen
if (!ds.includes('getScheduledObligationRows')) {
  ds = ds.replace(
    `import { calculateIndependentMortgageProjections, formatCurrency, acceptMoneyEdit, type DebtItem, type LoanBillPairing, type PayoffPlanResult } from '../onboarding-domain';`,
    `import { calculateIndependentMortgageProjections, formatCurrency, acceptMoneyEdit, type DebtItem, type LoanBillPairing, type PayoffPlanResult } from '../onboarding-domain';\nimport { createDebtMinimumPaymentTransaction, getScheduledObligationRows, type ScheduledObligationRow } from '../finance/payment-matching';\nimport { currentHouseholdDate, currentHouseholdMonth, getNextMonthString } from '../finance/calendar';\nimport * as Crypto from 'expo-crypto';\nimport { type ObligationSchedules } from '../finance/obligation-schedule';\nimport { type Money } from '../finance/money';`
  );
}

// Props in DebtScreen
ds = ds.replace(
  `mortgageEscrowByDebtId = {}, mortgageExtraPaymentByDebtId = {}, onMortgageExtra,\n  recurringBills = [], loanBillPairings = {}, onSaveLoanBillPairings,`,
  `mortgageEscrowByDebtId = {}, mortgageExtraPaymentByDebtId = {}, onMortgageExtra,\n  recurringBills = [], loanBillPairings = {}, onSaveLoanBillPairings,\n  obligationSchedules = {}, householdTimeZone, onAddTransaction, onRecordBillPayment,`
);

ds = ds.replace(
  `loanBillPairings?: Record<string, LoanBillPairing>;\n  onSaveLoanBillPairings?: (pairings: Record<string, LoanBillPairing>) => Promise<void>;\n  onDismiss?: () => void;`,
  `loanBillPairings?: Record<string, LoanBillPairing>;\n  onSaveLoanBillPairings?: (pairings: Record<string, LoanBillPairing>) => Promise<void>;\n  obligationSchedules?: ObligationSchedules;\n  householdTimeZone?: string;\n  onAddTransaction?: (tx: LedgerTransaction) => Promise<unknown> | unknown;\n  onRecordBillPayment?: (bill: RecurringBill, dueDate: string, remainingAmount: Money) => Promise<unknown> | unknown;\n  onDismiss?: () => void;`
);

// State for Scheduled
if (!ds.includes('scheduledMonthOffset')) {
  ds = ds.replace(
    `const [extraDraft, setExtraDraft] = useState(formatEditableMoney(extraMonthlyPayment, currencyCode));`,
    `const [extraDraft, setExtraDraft] = useState(formatEditableMoney(extraMonthlyPayment, currencyCode));\n  const [scheduledMonthOffset, setScheduledMonthOffset] = useState(0);\n  const [pendingBillCycle, setPendingBillCycle] = useState<string | null>(null);\n  const effectiveTimeZone = householdTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';\n  const currentMonthStr = currentHouseholdMonth(effectiveTimeZone);\n  const todayStr = currentHouseholdDate(effectiveTimeZone);`
  );
}

// initialSection handling
ds = ds.replace(
  `const [view, setView] = useState(initialSection === 'Strategy' ? 'Strategy' : 'Accounts');`,
  `const [view, setView] = useState(initialSection === 'Strategy' ? 'Strategy' : initialSection === 'Scheduled' ? 'Scheduled' : 'Accounts');`
);

ds = ds.replace(
  `setView(initialSection === 'Strategy' ? 'Strategy' : 'Accounts');\n    if (initialSection === 'Strategy') setSelectedId(null);`,
  `setView(initialSection === 'Strategy' ? 'Strategy' : initialSection === 'Scheduled' ? 'Scheduled' : 'Accounts');\n    if (initialSection === 'Strategy' || initialSection === 'Scheduled') setSelectedId(null);`
);

// Segments on DebtScreen
ds = ds.replace(
  `segments={['Accounts', 'Strategy']}\n      selected={view}\n      onSelect={value => setView(value)}`,
  `segments={['Accounts', 'Strategy', 'Scheduled']}\n      selected={view}\n      onSelect={value => { setView(value); if (value !== 'Accounts') setSelectedId(null); }}`
);

// Render Scheduled in DebtScreen
const scheduledCardBlock = `      ) : view === 'Strategy' ? (`;

const newScheduledCardBlock = `      ) : view === 'Scheduled' ? (
        <Card>
          <Text style={ui.heading}>Scheduled obligations</Text>
          <Text style={ui.text}>
            Browse monthly debt minimums and recurring obligations for the next 12 months.
          </Text>
          {(() => {
            let selectedMonth = currentMonthStr;
            for (let index = 0; index < scheduledMonthOffset; index += 1) selectedMonth = getNextMonthString(selectedMonth);
            return (
              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }]}>
                <Pressable
                  accessibilityRole=\"button\"
                  accessibilityLabel=\"Previous scheduled month\"
                  disabled={scheduledMonthOffset === 0}
                  onPress={() => setScheduledMonthOffset(val => Math.max(0, val - 1))}
                  style={[ui.button, scheduledMonthOffset === 0 && { opacity: 0.45 }]}
                >
                  <Text style={ui.buttonText}>Previous</Text>
                </Pressable>
                <Text accessibilityRole=\"header\" style={ui.heading}>
                  {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(\`\${selectedMonth}-01T12:00:00\`))}
                </Text>
                <Pressable
                  accessibilityRole=\"button\"
                  accessibilityLabel=\"Next scheduled month\"
                  disabled={scheduledMonthOffset >= 11}
                  onPress={() => setScheduledMonthOffset(val => Math.min(11, val + 1))}
                  style={[ui.button, scheduledMonthOffset >= 11 && { opacity: 0.45 }]}
                >
                  <Text style={ui.buttonText}>Next</Text>
                </Pressable>
              </View>
            );
          })()}
          {(() => {
            let selectedMonth = currentMonthStr;
            for (let index = 0; index < scheduledMonthOffset; index += 1) selectedMonth = getNextMonthString(selectedMonth);
            const allRows = getScheduledObligationRows({
              debts,
              recurringBills,
              transactions,
              asOfDate: todayStr,
              currencyCode,
              schedules: obligationSchedules,
              loanBillPairs: loanBillPairings,
            });
            const visibleRows = allRows.filter(
              row => row.dueCycleMonth === selectedMonth || (scheduledMonthOffset === 0 && row.dueDate < todayStr),
            );
            if (!visibleRows.length) return <Text style={[ui.text, { marginTop: 8 }]}>No scheduled obligations for this month.</Text>;
            return (
              <View style={{ marginTop: 10 }}>
                {visibleRows.map(row => {
                  const { bill, debt, dueDate: due, state } = row;
                  const match = state.confirmedMatch;
                  const isPending = state.status === 'pending_confirmation';
                  const isPastDue = due < todayStr && state.status !== 'paid';
                  const busyKey = \`\${row.kind}:\${row.kind === 'debt' ? debt?.id : bill?.id}:\${due}\`;
                  const displayName = row.kind === 'debt' ? \`\${debt?.name ?? row.name} minimum\` : bill?.name ?? row.name;

                  return (
                    <View key={row.id} style={[ui.divider, ui.row, { justifyContent: 'space-between', gap: 8 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={ui.heading}>{displayName}</Text>
                        <Text style={ui.small}>
                          {\`\${isPastDue ? 'Past due since ' : 'Due '}\${due} · \${
                            row.kind === 'debt' ? 'Minimum payment' : bill?.paymentMethod === 'credit' ? 'Charged to credit card' : 'Paid from checking'
                          }\`}
                        </Text>
                        <Text style={[ui.small, { color: match.isSatisfied ? '#86E3B8' : isPending ? '#F5C563' : isPastDue ? '#F08B78' : '#AAB3AD' }]}>
                          {match.isSatisfied
                            ? 'Paid'
                            : isPending
                              ? \`Awaiting confirmation · \${formatCurrency(moneyToMajor(state.pendingAmount), currencySymbol)} pending\`
                              : match.isPartiallyPaid
                                ? \`Partially paid · \${formatCurrency(moneyToMajor(match.remainingAmount), currencySymbol)} left\`
                                : isPastDue ? 'Past due · Unpaid' : 'Unpaid'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <Text style={ui.value}>{formatCurrency(moneyToMajor(row.requiredAmount), currencySymbol)}</Text>
                        {onAddTransaction ? (
                          <Pressable
                            accessibilityRole=\"button\"
                            disabled={match.isSatisfied || isPending || pendingBillCycle === busyKey}
                            onPress={async () => {
                              setPendingBillCycle(busyKey);
                              try {
                                if (row.kind === 'debt' && debt) {
                                  await onAddTransaction(createDebtMinimumPaymentTransaction({
                                    id: \`tx:\${Crypto.randomUUID()}\`, debt, today: todayStr, dueDate: due,
                                    amount: match.remainingAmount, createdAt: new Date().toISOString(),
                                  }));
                                } else if (row.kind === 'bill' && bill && onRecordBillPayment) {
                                  await onRecordBillPayment(bill, due, match.remainingAmount);
                                }
                              } finally {
                                setPendingBillCycle(null);
                              }
                            }}
                            style={[ui.button, { backgroundColor: '#76DCB9' }]}
                          >
                            <Text style={[ui.buttonText, { color: '#0C0E0D' }]}>
                              {pendingBillCycle === busyKey ? 'Saving…' : match.isSatisfied ? 'Paid' : isPending ? 'Awaiting confirmation' : match.isPartiallyPaid ? 'Record remaining' : 'Record paid'}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })()}
        </Card>
      ) : (`;

ds = ds.replace(
  `      </> : <>\n        <Segments items={['Debt strategy', 'Mortgage strategy']}`,
  `      </> : view === 'Scheduled' ? (\n        <Card>\n          <Text style={ui.heading}>Scheduled obligations</Text>\n          <Text style={ui.text}>\n            Browse monthly debt minimums and recurring obligations for the next 12 months.\n          </Text>\n          {(() => {\n            let selectedMonth = currentMonthStr;\n            for (let index = 0; index < scheduledMonthOffset; index += 1) selectedMonth = getNextMonthString(selectedMonth);\n            return (\n              <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }]}>\n                <Pressable\n                  accessibilityRole=\"button\"\n                  accessibilityLabel=\"Previous scheduled month\"\n                  disabled={scheduledMonthOffset === 0}\n                  onPress={() => setScheduledMonthOffset(val => Math.max(0, val - 1))}\n                  style={[ui.button, scheduledMonthOffset === 0 && { opacity: 0.45 }]}\n                >\n                  <Text style={ui.buttonText}>Previous</Text>\n                </Pressable>\n                <Text accessibilityRole=\"header\" style={ui.heading}>\n                  {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(\`\${selectedMonth}-01T12:00:00\`))}\n                </Text>\n                <Pressable\n                  accessibilityRole=\"button\"\n                  accessibilityLabel=\"Next scheduled month\"\n                  disabled={scheduledMonthOffset >= 11}\n                  onPress={() => setScheduledMonthOffset(val => Math.min(11, val + 1))}\n                  style={[ui.button, scheduledMonthOffset >= 11 && { opacity: 0.45 }]}\n                >\n                  <Text style={ui.buttonText}>Next</Text>\n                </Pressable>\n              </View>\n            );\n          })()}\n          {(() => {\n            let selectedMonth = currentMonthStr;\n            for (let index = 0; index < scheduledMonthOffset; index += 1) selectedMonth = getNextMonthString(selectedMonth);\n            const allRows = getScheduledObligationRows({\n              debts,\n              recurringBills,\n              transactions,\n              asOfDate: todayStr,\n              currencyCode,\n              schedules: obligationSchedules,\n              loanBillPairs: loanBillPairings,\n            });\n            const visibleRows = allRows.filter(\n              row => row.dueCycleMonth === selectedMonth || (scheduledMonthOffset === 0 && row.dueDate < todayStr),\n            );\n            if (!visibleRows.length) return <Text style={[ui.text, { marginTop: 8 }]}>No scheduled obligations for this month.</Text>;\n            return (\n              <View style={{ marginTop: 10 }}>\n                {visibleRows.map(row => {\n                  const { bill, debt, dueDate: due, state } = row;\n                  const match = state.confirmedMatch;\n                  const isPending = state.status === 'pending_confirmation';\n                  const isPastDue = due < todayStr && state.status !== 'paid';\n                  const busyKey = \`\${row.kind}:\${row.kind === 'debt' ? debt?.id : bill?.id}:\${due}\`;\n                  const displayName = row.kind === 'debt' ? \`\${debt?.name ?? row.name} minimum\` : bill?.name ?? row.name;\n\n                  return (\n                    <View key={row.id} style={[ui.divider, ui.row, { justifyContent: 'space-between', gap: 8 }]}>\n                      <View style={{ flex: 1 }}>\n                        <Text style={ui.heading}>{displayName}</Text>\n                        <Text style={ui.small}>\n                          {\`\${isPastDue ? 'Past due since ' : 'Due '}\${due} · \${row.kind === 'debt' ? 'Minimum payment' : bill?.paymentMethod === 'credit' ? 'Charged to credit card' : 'Paid from checking'}\`}\n                        </Text>\n                        <Text style={[ui.small, { color: match.isSatisfied ? '#86E3B8' : isPending ? '#F5C563' : isPastDue ? '#F08B78' : '#AAB3AD' }]}>\n                          {match.isSatisfied\n                            ? 'Paid'\n                            : isPending\n                              ? \`Awaiting confirmation · \${formatCurrency(moneyToMajor(state.pendingAmount), currencySymbol)} pending\`\n                              : match.isPartiallyPaid\n                                ? \`Partially paid · \${formatCurrency(moneyToMajor(match.remainingAmount), currencySymbol)} left\`\n                                : isPastDue ? 'Past due · Unpaid' : 'Unpaid'}\n                        </Text>\n                      </View>\n                      <View style={{ alignItems: 'flex-end', gap: 6 }}>\n                        <Text style={ui.value}>{formatCurrency(moneyToMajor(row.requiredAmount), currencySymbol)}</Text>\n                        {onAddTransaction ? (\n                          <Pressable\n                            accessibilityRole=\"button\"\n                            disabled={match.isSatisfied || isPending || pendingBillCycle === busyKey}\n                            onPress={async () => {\n                              setPendingBillCycle(busyKey);\n                              try {\n                                if (row.kind === 'debt' && debt) {\n                                  await onAddTransaction(createDebtMinimumPaymentTransaction({\n                                    id: \`tx:\${Crypto.randomUUID()}\`, debt, today: todayStr, dueDate: due,\n                                    amount: match.remainingAmount, createdAt: new Date().toISOString(),\n                                  }));\n                                } else if (row.kind === 'bill' && bill && onRecordBillPayment) {\n                                  await onRecordBillPayment(bill, due, match.remainingAmount);\n                                }\n                              } finally {\n                                setPendingBillCycle(null);\n                              }\n                            }}\n                            style={[ui.button, { backgroundColor: '#76DCB9' }]}\n                          >\n                            <Text style={[ui.buttonText, { color: '#0C0E0D' }]}>\n                              {pendingBillCycle === busyKey ? 'Saving…' : match.isSatisfied ? 'Paid' : isPending ? 'Awaiting confirmation' : match.isPartiallyPaid ? 'Record remaining' : 'Record paid'}\n                            </Text>\n                          </Pressable>\n                        ) : null}\n                      </View>\n                    </View>\n                  );\n                })}\n              </View>\n            );\n          })()}\n        </Card>\n      ) : (\n        <>\n        <Segments items={['Debt strategy', 'Mortgage strategy']}`
);

// Close the conditional
ds = ds.replace(
  `          </Card>\n        </>\n      )}`,
  `          </Card>\n        </>\n      )}`
);

fs.writeFileSync('src/screens/DebtScreen.tsx', ds, 'utf8');
console.log('Updated DebtScreen.tsx');


// ========================================================
// 4. HomeScreen.tsx: Pass props to DebtScreen and wire Budget
// ========================================================
let hs = fs.readFileSync('src/screens/HomeScreen.tsx', 'utf8');

// Pass obligationSchedules and handlers to DebtScreen
hs = hs.replace(
  `loanBillPairings={onboardingData.loanBillPairingByDebtId ?? {}}\n          onSaveLoanBillPairings={handleSaveLoanBillPairings}\n        />`,
  `loanBillPairings={onboardingData.loanBillPairingByDebtId ?? {}}\n          onSaveLoanBillPairings={handleSaveLoanBillPairings}\n          obligationSchedules={onboardingData.obligationSchedules}\n          householdTimeZone={householdTimeZone}\n          onAddTransaction={onAddTransaction}\n          onRecordBillPayment={onRecordBillPayment}\n        />`
);

// Replace budget rendering in HomeScreen
hs = hs.replace(
  `budget={(navigate: (tab: any, section?: string) => void, section: string) => section === 'Scheduled' ? (\n        <TransactionsScreen initialSection=\"Scheduled\" budgetScheduled onBudgetSection={next => navigate('budget', next)} debts={onboardingData.debts} transactions={transactions} recurringBills={recurringBills} obligationSchedules={onboardingData.obligationSchedules} loanBillPairs={loanBillPairs} householdTimeZone={householdTimeZone} currencySymbol={currencySymbol} currencyCode={currencyCode} onRecordBillPayment={onRecordBillPayment} onAddTransaction={onAddTransaction} onUpdateTransaction={onUpdateTransaction} onDeleteTransaction={onDeleteTransaction} onSettings={openSettings} />\n      ) : (\n        <BudgetScreen\n          data={onboardingData}\n          plan={plan}\n          initialSection={section as 'Budget' | 'Upcoming'}\n          currencySymbol={currencySymbol}\n          currencyCode={currencyCode}\n          householdTimeZone={householdTimeZone}\n          transactions={transactions}\n          recurringBills={recurringBills}\n          reconciliationAnchors={reconciliationAnchors}\n          onAddRecurringBill={onAddRecurringBill}\n          onDeleteRecurringBill={onDeleteRecurringBill}\n          onOpenStrategy={() => navigate('debt', 'Strategy')}\n          onOpenScheduled={() => navigate('budget', 'Scheduled')}`,
  `budget={(navigate: (tab: any, section?: string) => void, section: string) => (\n        <BudgetScreen\n          data={onboardingData}\n          plan={plan}\n          initialSection={section as 'Budget' | 'Upcoming'}\n          currencySymbol={currencySymbol}\n          currencyCode={currencyCode}\n          householdTimeZone={householdTimeZone}\n          transactions={transactions}\n          recurringBills={recurringBills}\n          reconciliationAnchors={reconciliationAnchors}\n          onAddRecurringBill={onAddRecurringBill}\n          onDeleteRecurringBill={onDeleteRecurringBill}\n          onOpenStrategy={() => navigate('debt', 'Strategy')}\n          onOpenScheduled={() => navigate('debt', 'Scheduled')}`
);

fs.writeFileSync('src/screens/HomeScreen.tsx', hs, 'utf8');
console.log('Updated HomeScreen.tsx');


// ========================================================
// 5. FiveTabShell.tsx: Navigation to Debt Scheduled
// ========================================================
let fts = fs.readFileSync('src/FiveTabShell.tsx', 'utf8');

fts = fts.replace(
  `setDebtSection(section === 'Strategy' ? 'Strategy' : 'Cards & Loans');\n      setTargetDebtId(section && section !== 'Strategy' ? section : null);`,
  `setDebtSection(section === 'Strategy' ? 'Strategy' : section === 'Scheduled' ? 'Scheduled' : 'Cards & Loans');\n      setTargetDebtId(section && section !== 'Strategy' && section !== 'Scheduled' ? section : null);`
);

fs.writeFileSync('src/FiveTabShell.tsx', fts, 'utf8');
console.log('Updated FiveTabShell.tsx');

console.log('All updates written.');
