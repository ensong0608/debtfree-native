const fs=require('fs');
function edit(p,f){let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n'); fs.writeFileSync(p,f(s));}
edit('src/OnboardingAndHome.tsx',s=>{
s=s.replace("import { validatedLoanBillLinks, withoutDeletedBillPairings, withoutIncompatibleDebtPairing }","import { validatedLoanBillLinks, withoutDeletedBillPairings, withoutIncompatibleDebtPairing, canEditDebtCategoryWithPairings }");
s=s.replace("import { parseMoney, type Money }","import { prepareUnifiedLoanSettings } from './finance/unified-loan';\nimport { parseMoney, type Money }");
s=s.replace("    const dueDay = validation.debt.dueDay;","    const dueDay = validation.debt.dueDay;\n    if (existingDebt) {\n      const allowed = canEditDebtCategoryWithPairings(onboardingData.loanBillPairingByDebtId, debtId, validation.debt.category, recurringBills);\n      if (!allowed.valid) { setLocalError(allowed.error); return; }\n    }");
const a=s.indexOf("      const updated = debtUnchanged ? onboardingData : await upsertUserDebt(onboardingData, {"), b=s.indexOf("      onUpdateOnboardingData(updated);",a);
if(a<0||b<0)throw Error('onboarding anchors');
s=s.slice(0,a)+"      const debtInput = { id: debtId, ...validation.debt };\n      const unified = debtInput.category === 'Mortgage' || debtInput.category === 'Auto loan';\n      const loanSettings = unified ? prepareUnifiedLoanSettings({ current: onboardingData, debt: { ...debtInput, createdAt: existingDebt?.createdAt ?? new Date().toISOString() }, bills: recurringBills, today, currency: currencyCode, paidToday }) : undefined;\n      const updated = !unified && debtUnchanged ? onboardingData : await upsertUserDebt(onboardingData, debtInput, loanSettings);\n"+s.slice(b);
s=s.replace("      const savedDebt = updated.debts.find(debt => debt.id === debtId);","      if (!unified) {\n      const savedDebt = updated.debts.find(debt => debt.id === debtId);");
s=s.replace("      setShowDebtForm(false);\n      setEditingDebtId(null);\n      draftDebtIdRef.current = null;","      }\n      setShowDebtForm(false);\n      setEditingDebtId(null);\n      draftDebtIdRef.current = null;");
const del="      const localBillId = validatedLoanBillLinks(onboardingData.loanBillPairingByDebtId, recurringBills, onboardingData.debts)[debtId] ?? null;";
s=s.replace(del,del+"\n      const relation = onboardingData.loanBillPairingByDebtId?.[debtId];\n      if (relation?.status === 'linked' && relation.billId !== localBillId) throw new Error('Historical bill ownership cannot be safely validated for deletion. No records were removed.');");
return s;
});

