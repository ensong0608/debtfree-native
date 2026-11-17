const fs=require('fs');
function edit(p,f){let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');fs.writeFileSync(p,f(s));}
function removeBlock(s,needle,open='<ConfirmModal',close='\n      />'){const at=s.indexOf(needle);if(at<0)return s;const a=s.lastIndexOf(open,at),b=s.indexOf(close,at);return s.slice(0,a)+s.slice(b+close.length);}
edit('src/screens/DebtScreen.tsx',s=>{
s=s.replace("recurringBills = [], loanBillPairings = {}, onSaveLoanBillPairings,","recurringBills = [], loanBillPairings = {},");
s=s.replace(/  const \[pairingBusy, setPairingBusy\].*\n/,'').replace(/  const \[pairingError, setPairingError\].*\n/,'').replace(/  const \[confirmPairingAction, setConfirmPairingAction\].*\n/,'');
const a=s.indexOf('  const saveSelectedPairing ='),b=s.indexOf('  const startReconcile',a);if(a>=0)s=s.slice(0,a)+s.slice(b);
s=removeBlock(s,'visible={confirmPairingAction');
s=s.replace(/\s*\{!!pairingError && <Text[\s\S]*?\{pairingError\}<\/Text>\}/,'');
s=s.replace("Boolean(selectedLinkedBillId && transactionHasBillId(tx, selectedLinkedBillId))","Boolean(tx.accountId === null && selectedLinkedBillId && transactionHasBillId(tx, selectedLinkedBillId))");
return s;
});
edit('src/screens/BudgetScreen.tsx',s=>{
s=s.replace(/  const \[pairingBusy, setPairingBusy\].*\n/,'').replace(/  const \[confirmUnlinkLoan, setConfirmUnlinkLoan\].*\n/,'');
const a=s.indexOf('  const savePairing ='),b=s.indexOf('  const openBillEditor',a);if(a>=0)s=s.slice(0,a)+s.slice(b);
s=removeBlock(s,'visible={confirmUnlinkLoan');
s=s.replace("  const openBillEditor = (bill: RecurringBill) => {","  const openBillEditor = (bill: RecurringBill) => {\n    const claimed = Object.values(data.loanBillPairingByDebtId ?? {}).some(relation => relation?.status === 'linked' && relation.billId === bill.id);\n    if (claimed && !Object.values(uniqueHistoricalBillIdByDebtId(data.loanBillPairingByDebtId)).includes(bill.id)) { Alert.alert('Loan review required', 'Multiple saved identities claim this recurring item. Its history must be reviewed before editing.'); return; }");
s=s.replace("  const handleSaveBill = async () => {","  const handleSaveBill = async () => {\n    if (editingBill && Object.values(data.loanBillPairingByDebtId ?? {}).some(relation => relation?.status === 'linked' && relation.billId === editingBill.id)) { setAddBillError('Edit this loan from Accounts so its history and schedule stay together.'); return; }");
s=s.replace("budgetUnresolved ? '\ufffd'","budgetUnresolved ? 'N/A'");
s=s.split('\n').map(line=>line.includes('<View accessibilityLabel=')&&line.includes('item.percentOfIncome')?line.replace(/accessibilityLabel=\{.*?\} style=/,"accessibilityLabel={budgetUnresolved ? 'Percentage unavailable until loan review' : item.label + ': ' + item.percentOfIncome + '% of income'} style="):line).join('\n');
return s;
});
edit('src/screens/HomeScreen.tsx',s=>{
s=s.replace("  type LoanBillPairing,\n","").replace("  auditLegacyLoanPairings,\n","");
s=s.replace("{debt.name} \ufffd Set due day","{debt.name} - Set due day");
s=s.replace("  const canonicalPlanAliases = Object.fromEntries(Object.entries(historicalLoanBillIds).filter(([id]) => !loanRuntime.legacyPairs[id] && !loanRuntime.excludedDebtIds.includes(id)));","  const canonicalPlanAliases = useMemo(() => Object.fromEntries(Object.entries(loanRuntime.aliases).filter(([id]) => !loanRuntime.legacyPairs[id] && !loanRuntime.excludedDebtIds.includes(id))), [loanRuntime]);");
s=s.replace("  const effectiveDebtSplitPlans = resolveUnifiedDebtSplitPlans(onboardingData.debtPaymentSplitPlansByDebtId, onboardingData.billPaymentSplitPlansByBillId, canonicalPlanAliases);","  const effectiveDebtSplitPlans = useMemo(() => resolveUnifiedDebtSplitPlans(onboardingData.debtPaymentSplitPlansByDebtId, onboardingData.billPaymentSplitPlansByBillId, canonicalPlanAliases), [onboardingData.debtPaymentSplitPlansByDebtId, onboardingData.billPaymentSplitPlansByBillId, canonicalPlanAliases]);");
s=s.replace("[scheduledRows, onboardingData.debtPaymentSplitPlansByDebtId, onboardingData.billPaymentSplitPlansByBillId, transactions, todayKey]","[scheduledRows, effectiveDebtSplitPlans, onboardingData.billPaymentSplitPlansByBillId, historicalLoanBillIds, transactions, todayKey]");
return s;
});
edit('src/finance/payment-matching.ts',s=>{
s=s.replace("if (isHistBillTx && (tx.category === 'payment' || tx.category === 'debit_bill')) {","if (isHistBillTx && (tx.accountId === null || tx.accountId === obligation.accountId) && (tx.category === 'payment' || tx.category === 'debit_bill')) {");
return s;
});
edit('src/finance/loan-bill-pairing.ts',s=>{
s=s.replace("(!bill || bill.amount.currency === currencyCode)","(!bill || bill.amount.currency === (currencyCode ?? bill.amount.currency))");
return s;
});

