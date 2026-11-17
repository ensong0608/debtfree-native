const fs=require('fs');
function edit(p,f){let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');fs.writeFileSync(p,f(s));}
edit('src/finance/loan-bill-pairing.ts',s=>{
s=s.replace("  return [...excludedSet];\n}\n\nexport function linkedDebtByBillId","  for (const [debtId, billIds] of Object.entries(historicalBillIdsByDebtId(pairings))) {\n    const debt = debtById.get(debtId);\n    if (pairings[debtId]?.canonical && !divergentSet.has(debtId) && debt && isUnifiedBudgetLoanCategory(debt.category) && (debt.balance > 0 || isPaidOffAccountArchived(debt, archivedPaidOffDebtIds))) {\n      for (const billId of billIds) excludedSet.add(billId);\n    }\n  }\n  return [...excludedSet];\n}\n\nexport function linkedDebtByBillId");
return s;
});
edit('src/screens/TransactionsScreen.tsx',s=>{
s=s.replace("const linkedDebtName = identifiedBill ? linkedDebtNameByBillId.get(identifiedBill.id) : undefined;","const aliasDebtId = Object.entries(identityLoanBillPairs).find(([id, billId]) => (tx.accountId === null || tx.accountId === id) && transactionHasBillId(tx, billId))?.[0];\n              const linkedDebtName = aliasDebtId ? debtNamesById.get(aliasDebtId) : undefined;");
return s;
});
for(const p of ['src/screens/BudgetScreen.tsx','src/screens/DebtScreen.tsx','src/screens/HomeScreen.tsx']) edit(p,s=>s.replace(/[ \t]+\n/g,'\n'));

