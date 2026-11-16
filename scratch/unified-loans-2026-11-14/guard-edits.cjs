const fs=require('fs');
function edit(p,f){let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');fs.writeFileSync(p,f(s));}
edit('src/screens/DebtScreen.tsx',s=>s.replace('    setConfirmPairingAction(null);\n',''));
edit('src/OnboardingAndHome.tsx',s=>{
s=s.replace("  const handleAddRecurringBill = async (bill: RecurringBill) => {\n    if (!onboardingData) throw new Error('Onboarding settings are unavailable. Reload and retry.');","  const handleAddRecurringBill = async (bill: RecurringBill) => {\n    if (!onboardingData) throw new Error('Onboarding settings are unavailable. Reload and retry.');\n    if (Object.values(onboardingData.loanBillPairingByDebtId ?? {}).some(relation => relation?.status === 'linked' && relation.billId === bill.id)) throw new Error('Edit this loan from Accounts or Budget. Its historical bill is not independently editable.');");
s=s.replace("    const freshRecords = await loadFinanceRecords({ session, userId: freshData.userId, currency: resolveCurrencyOption(freshData).code, householdContext: freshData.householdContext });","    if (Object.values(freshData.loanBillPairingByDebtId ?? {}).some(relation => relation?.status === 'linked' && relation.billId === billId)) throw new Error('This recurring item belongs to a loan history. Remove the loan through its account confirmation; no records were changed.');\n    const freshRecords = await loadFinanceRecords({ session, userId: freshData.userId, currency: resolveCurrencyOption(freshData).code, householdContext: freshData.householdContext });");
return s;
});
edit('src/onboarding-storage.ts',s=>{
s=s.replace("  const currency = resolveCurrencyOption(current).code;\n  const now = new Date().toISOString();\n  const values =","  const currency = resolveCurrencyOption(current).code;\n  const values =");
s=s.replace("  if (response.error && !atomicLoanSettings || !row) {","  if ((response.error && !atomicLoanSettings) || !row) {");
return s;
});

