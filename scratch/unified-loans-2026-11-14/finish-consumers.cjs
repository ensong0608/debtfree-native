const fs=require('fs');
function edit(p,f){const s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');fs.writeFileSync(p,f(s));}
function removeElement(s,target,open='<Pressable',close='</Pressable>'){const at=s.indexOf(target);if(at<0)return s;const a=s.lastIndexOf(open,at),b=s.indexOf(close,at);if(a<0||b<0)throw Error(target);return s.slice(0,a)+s.slice(b+close.length);}
edit('src/screens/DebtScreen.tsx',s=>{
s=removeElement(s,"onPress={() => setConfirmPairingAction('unlink')}");
s=removeElement(s,"onPress={() => setConfirmPairingAction('remove')}");
s=s.replace(/\{canEdit \? \(\s*\) : null\}/g,'');
return s;
});
edit('src/screens/TransactionsScreen.tsx',s=>{
s=s.replace("  loanBillPairs = {}, identityLoanBillPairs = {},","  loanBillPairs = {}, identityLoanBillPairs = {},\n  historicalBillIdsByDebtId = {}, excludedObligationDebtIds = EMPTY_STRING_LIST,");
s=s.replace("  identityLoanBillPairs?: Readonly<Record<string, string>>;","  identityLoanBillPairs?: Readonly<Record<string, string>>;\n  historicalBillIdsByDebtId?: Readonly<Record<string, readonly string[]>>;\n  excludedObligationDebtIds?: readonly string[];");
s=s.replace("            debts,\n            recurringBills,","            debts: debts.filter(debt => !excludedObligationDebtIds.includes(debt.id)),\n            recurringBills,");
s=s.replace("            loanBillPairs,\n            excludedBillIds:","            loanBillPairs,\n            historicalBillIdsByDebtId,\n            excludedBillIds:");
s=s.replace("obligationSchedules, loanBillPairs, excludedObligationBillIds]","obligationSchedules, loanBillPairs, historicalBillIdsByDebtId, excludedObligationDebtIds, excludedObligationBillIds]");
s=s.replace("            billPlans: billPaymentSplitPlansByBillId,","            billPlans: billPaymentSplitPlansByBillId,\n            historicalBillIdsByDebtId,");
s=s.replace("debtPaymentSplitPlansByDebtId, billPaymentSplitPlansByBillId, transactions, todayStr]","debtPaymentSplitPlansByDebtId, billPaymentSplitPlansByBillId, historicalBillIdsByDebtId, transactions, todayStr]");
s=s.replace("if (tx.accountId !== debtId && !(identityLoanBillPairs[debtId] && transactionHasBillId(tx, identityLoanBillPairs[debtId]))) return false;","if (tx.accountId !== debtId && !(tx.accountId === null && identityLoanBillPairs[debtId] && transactionHasBillId(tx, identityLoanBillPairs[debtId]))) return false;");
return s;
});
edit('src/screens/HomeScreen.tsx',s=>{
s=s.replace("          identityLoanBillPairs={identityLoanBillPairs}","          identityLoanBillPairs={identityLoanBillPairs}\n          historicalBillIdsByDebtId={historicalLoanBillIds}\n          excludedObligationDebtIds={loanRuntime.excludedDebtIds}");
s=s.replace("            loanBillPairs={loanBillPairs}","            loanBillPairs={loanBillPairs}\n            historicalBillIdsByDebtId={historicalLoanBillIds}");
s=s.replace("disabled={pairingBusy}\n                                onPress={() => void handleResolve","disabled={!canEdit || pairingBusy}\n                                onPress={() => void handleResolve");
s=s.replace("disabled={pairingBusy}\n                              onPress={() => void handleResolve","disabled={!canEdit || pairingBusy}\n                              onPress={() => void handleResolve");
return s;
});
edit('src/components/ObligationPaySheet.tsx',s=>{
s=s.replace("  loanBillPairs = {},","  loanBillPairs = {},\n  historicalBillIdsByDebtId = {},");
s=s.replace("  loanBillPairs?: Readonly<Record<string, string>>;","  loanBillPairs?: Readonly<Record<string, string>>;\n  historicalBillIdsByDebtId?: Readonly<Record<string, readonly string[]>>;");
s=s.replace("        debt: target.debt,","        debt: target.debt,\n        historicalBillIds: target.debt ? historicalBillIdsByDebtId[target.debt.id] : undefined,");
return s;
});
edit('src/components/UpcomingObligations.tsx',s=>{
s=s.replace("loanBillPairs = {}, excludedBillIds = [],","loanBillPairs = {}, excludedBillIds = [], historicalBillIdsByDebtId = {},");
s=s.replace("  householdTimeZone?: string; currencyCode: string; currencySymbol: string;","  historicalBillIdsByDebtId?: Readonly<Record<string, readonly string[]>>;\n  householdTimeZone?: string; currencyCode: string; currencySymbol: string;");
s=s.replace("currencyCode, schedules: obligationSchedules, loanBillPairs, excludedBillIds };","currencyCode, schedules: obligationSchedules, loanBillPairs, excludedBillIds, historicalBillIdsByDebtId };");
s=s.replace("        debt: payNowTarget.debt,","        debt: payNowTarget.debt,\n        historicalBillIds: payNowTarget.debt ? historicalBillIdsByDebtId[payNowTarget.debt.id] : undefined,");
return s;
});

