const fs=require('fs');
function edit(p,f){let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');s=f(s);fs.writeFileSync(p,s)}
edit('src/screens/HomeScreen.tsx',s=>{
s=s.replace("  activeLoanBillLinks,\n","  unifiedLoanRuntime,\n  uniqueHistoricalBillIdByDebtId,\n  canEditDebtCategoryWithPairings,\n  validateDivergentLinkResolution,\n  loansWithIncompleteSchedule,\n");
s=s.replace("  withoutIncompatibleDebtPairing,\n","");
s=s.replace("import { moneyToMajor, parseMoney, type Money }","import { prepareUnifiedLoanSettings } from '../finance/unified-loan';\nimport { moneyToMajor, parseMoney, type Money }");
const a=s.indexOf("  const loanBillPairs = activeLoanBillLinks("), b=s.indexOf("  const debtById =",a);
if(a<0||b<0)throw Error('runtime anchor');
s=s.slice(0,a)+"  const loanRuntime = useMemo(() => unifiedLoanRuntime({ debts: onboardingData.debts, bills: recurringBills, pairings: onboardingData.loanBillPairingByDebtId, archived: onboardingData.archivedPaidOffDebtIds, currency: currencyCode }), [onboardingData.debts, recurringBills, onboardingData.loanBillPairingByDebtId, onboardingData.archivedPaidOffDebtIds, currencyCode]);\n  const loanBillPairs = loanRuntime.legacyPairs;\n  const historicalLoanBillIds = loanRuntime.aliases;\n  const identityLoanBillPairs = uniqueHistoricalBillIdByDebtId(onboardingData.loanBillPairingByDebtId);\n  const pairingAudit = loanRuntime.audit;\n  const scheduledDebtAccounts = useMemo(() => onboardingData.debts.filter(debt => !loanRuntime.excludedDebtIds.includes(debt.id)), [onboardingData.debts, loanRuntime]);\n  const incompleteLoanSchedules = loansWithIncompleteSchedule(onboardingData.debts, onboardingData.archivedPaidOffDebtIds);\n"+s.slice(b);
const c=s.indexOf("  const archivedLinkedBillIds = recurringBillsForArchivedLoans("),d=s.indexOf("  const windowEndKey",c);
s=s.slice(0,c)+"  const archivedLinkedBillIds = loanRuntime.excludedBillIds;\n"+s.slice(d);
s=s.replace("  recurringBillsForArchivedLoans,\n","");
s=s.replace("        debts: onboardingData.debts,\n        recurringBills,","        debts: scheduledDebtAccounts,\n        recurringBills,");
s=s.replace("    debts: onboardingData.debts,\n    recurringBills,\n    transactions,\n    asOfDate: todayKey,","    debts: scheduledDebtAccounts,\n    recurringBills,\n    transactions,\n    asOfDate: todayKey,");
s=s.replaceAll("        loanBillPairs,\n        excludedBillIds:","        loanBillPairs,\n        historicalBillIdsByDebtId: historicalLoanBillIds,\n        excludedBillIds:");
s=s.replaceAll("    loanBillPairs,\n    excludedBillIds:","    loanBillPairs,\n    historicalBillIdsByDebtId: historicalLoanBillIds,\n    excludedBillIds:");
s=s.replace("[onboardingData.debts, recurringBills, transactions, todayKey, currencyCode, onboardingData.obligationSchedules, loanBillPairs, archivedLinkedBillIds]","[scheduledDebtAccounts, recurringBills, transactions, todayKey, currencyCode, onboardingData.obligationSchedules, loanBillPairs, historicalLoanBillIds, archivedLinkedBillIds]");
s=s.replace("            billPlans: onboardingData.billPaymentSplitPlansByBillId,","            billPlans: onboardingData.billPaymentSplitPlansByBillId,\n            historicalBillIdsByDebtId: historicalLoanBillIds,");
s=s.replace("      billPlans: onboardingData.billPaymentSplitPlansByBillId,","      billPlans: onboardingData.billPaymentSplitPlansByBillId,\n      historicalBillIdsByDebtId: historicalLoanBillIds,");
s=s.replace("          identityLoanBillPairs={identityLoanBillPairs}","          identityLoanBillPairs={identityLoanBillPairs}\n          historicalBillIdsByDebtId={historicalLoanBillIds}\n          excludedObligationDebtIds={loanRuntime.excludedDebtIds}");
s=s.replace("            loanBillPairs={loanBillPairs}","            loanBillPairs={loanBillPairs}\n            historicalBillIdsByDebtId={historicalLoanBillIds}");
const old="    const existingDebt = targetDebtId ? currentData.debts.find(d => d.id === targetDebtId) : undefined;";
s=s.replace(old,old+"\n    if (targetDebtId) {\n      const allowed = canEditDebtCategoryWithPairings(currentData.loanBillPairingByDebtId, targetDebtId, draft.category, recurringBills);\n      if (!allowed.valid) throw new Error(allowed.error);\n    }");
const start=s.indexOf("      const updated = await upsertUserDebt(currentData, {",s.indexOf('const saveDebtRecord'));
const termsEnd=s.indexOf("      latestOnboardingRef.current = updated;",start);
const input=s.slice(start,termsEnd).replace("      const updated = await upsertUserDebt(currentData, {","      const debtInput = {").replace(/\n      \}\);\n$/,"\n      };\n");
const saveEnd=s.indexOf("      if (isDraftFlow) {",termsEnd);
if(start<0||saveEnd<0)throw Error('save anchors');
const oldSave=s.slice(termsEnd,saveEnd);
const schedulePart=oldSave.slice(oldSave.indexOf("      if (dueDayNum !== null) {"),oldSave.indexOf("      if (!wasDivergentLink"));
s=s.slice(0,start)+input+
"      const unified = draft.category === 'Mortgage' || draft.category === 'Auto loan';\n      const loanSettings = unified ? prepareUnifiedLoanSettings({ current: currentData, debt: { ...debtInput, createdAt: existingDebt?.createdAt ?? new Date().toISOString() }, bills: recurringBills, today, currency: currencyCode, paidToday, escrow: escrowNum }) : undefined;\n      const updated = await upsertUserDebt(currentData, debtInput, loanSettings);\n      latestOnboardingRef.current = updated;\n      onUpdateOnboardingData(updated);\n      let settingsData = updated;\n      if (!unified) {\n"+schedulePart+"      }\n"+s.slice(saveEnd);
const resolveStart=s.indexOf("  const handleResolveDivergentLink = async");
const resolveEnd=s.indexOf("\n  const ",resolveStart+10);
if(resolveStart<0||resolveEnd<0)throw Error('resolve anchors');
s=s.slice(0,resolveStart)+
"  const handleResolveDivergentLink = async (link: DivergentLoanBillLink, mode: 'use_loan' | 'use_bill') => {\n    if (!canEdit || pairingBusy || savingRef.current) return;\n    clearErrors();\n    const current = latestOnboardingRef.current;\n    const liveDebt = current.debts.find(item => item.id === link.debt.id);\n    const liveBill = recurringBills.find(item => item.id === link.bill.id);\n    if (!liveDebt || !liveBill) { setLocalError('Reload to review the current loan terms.'); return; }\n    const validation = validateDivergentLinkResolution({ link: { ...link, debt: liveDebt, bill: liveBill }, mode, currencyCode, mortgageEscrowByDebtId: current.mortgageEscrowByDebtId });\n    if (!validation.valid) { setLocalError(validation.error); return; }\n    setPairingBusy(true);\n    savingRef.current = true;\n    try {\n      const debt = { ...liveDebt, minimumPayment: validation.minimumPayment, dueDay: validation.dueDay };\n      const settings = prepareUnifiedLoanSettings({ current, debt, bills: recurringBills, today: currentHouseholdDate(householdTimeZone), currency: currencyCode, resolveLegacy: true });\n      const updated = await upsertUserDebt(current, debt, settings);\n      latestOnboardingRef.current = updated;\n      onUpdateOnboardingData(updated);\n    } catch (error) { setLocalError(error instanceof Error ? error.message : 'Unable to verify the loan conversion.'); }\n    finally { savingRef.current = false; setPairingBusy(false); }\n  };\n"+s.slice(resolveEnd);

return s;
});

