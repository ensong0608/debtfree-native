const fs=require('fs');
function edit(p,f){let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');fs.writeFileSync(p,f(s));}
edit('src/finance/payment-matching.ts',s=>{
const a=s.indexOf('  const debtSchedule =',s.indexOf('export function resolveEffectiveDebtSchedule')),b=s.indexOf('\nexport type ObligationMatchResult',a);
if(a<0||b<0)throw Error('schedule helper');
s=s.slice(0,a)+"  // An atomically saved debt schedule already contains the preserved bill history.\n  // Never overlay the independently stored legacy schedule onto it again.\n  return schedules?.[obligationScheduleKey('debt', debtId)]\n    ?? historicalBillIds.map(id => schedules?.[obligationScheduleKey('bill', id)]).find(Boolean);\n}\n"+s.slice(b);
return s;
});
edit('src/finance/debt-payment-split.ts',s=>{
const a=s.indexOf('/** Calendar events are intentionally');
s=s.slice(0,a)+"/** Preserve earlier legacy plan terms while canonical loan edits own later cycles. */\nexport function resolveUnifiedDebtSplitPlans(\n  plans: DebtPaymentSplitPlansByDebtId = {},\n  billPlans: BillPaymentSplitPlansByBillId = {},\n  aliases: Readonly<Record<string, readonly string[]>> = {},\n): Record<string, PaymentSplitPlan> {\n  const result = { ...plans };\n  for (const [debtId, billIds] of Object.entries(aliases)) {\n    const terms = new Map<string, SplitPlanTerm>();\n    for (const billId of billIds) for (const term of billPlans[billId]?.terms ?? []) terms.set(term.effectiveMonth, term);\n    for (const term of plans[debtId]?.terms ?? []) terms.set(term.effectiveMonth, term);\n    if (terms.size) result[debtId] = { terms: [...terms.values()].sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth)) };\n  }\n  return result;\n}\n\n"+s.slice(a);
s=s.replace("  const events: PlannedDebtInstallment[] = [];","  const events: PlannedDebtInstallment[] = [];\n  const effectivePlans = resolveUnifiedDebtSplitPlans(params.plans, params.billPlans, params.historicalBillIdsByDebtId);");
s=s.replace("(params.plans?.[row.debt.id] ?? historicalBillIds.map(billId => params.billPlans?.[billId]).find(Boolean))","effectivePlans[row.debt.id]");
return s;
});
edit('src/finance/unified-loan.ts',s=>{
s=s.replace("import { resolveEffectiveDebtSchedule } from './payment-matching.ts';","import { resolveEffectiveDebtSchedule } from './payment-matching.ts';\n// @ts-ignore TS5097\nimport { resolveUnifiedDebtSplitPlans } from './debt-payment-split.ts';");
s=s.replace("'mortgageExtraPaymentByDebtId' | 'loanBillPairingByDebtId'>","'mortgageExtraPaymentByDebtId' | 'loanBillPairingByDebtId' | 'debtPaymentSplitPlansByDebtId' | 'billPaymentSplitPlansByBillId'>");
s=s.replace("  const obligationSchedules =","  const relation = current.loanBillPairingByDebtId?.[debt.id];\n  const legacySchedule = aliases.map(id => current.obligationSchedules?.['bill:' + id]).find(Boolean);\n  const obligationSchedules =");
s=s.replace("existing: resolveEffectiveDebtSchedule(current.obligationSchedules, debt.id, aliases),","existing: relation?.canonical ? resolveEffectiveDebtSchedule(current.obligationSchedules, debt.id, aliases)\n        : legacySchedule ?? current.obligationSchedules?.['debt:' + debt.id],");
s=s.replace("  const relation = loanBillPairingByDebtId[debt.id];\n","");
// Move the plan identity while preserving its complete term history in the canonical map.
s=s.replace("  return { obligationSchedules, mortgageEscrowByDebtId, mortgageExtraPaymentByDebtId, loanBillPairingByDebtId };","  const debtPaymentSplitPlansByDebtId = { ...(current.debtPaymentSplitPlansByDebtId ?? {}) };\n  const billPaymentSplitPlansByBillId = { ...(current.billPaymentSplitPlansByBillId ?? {}) };\n  const effective = resolveUnifiedDebtSplitPlans(debtPaymentSplitPlansByDebtId, billPaymentSplitPlansByBillId, { [debt.id]: aliases });\n  if (effective[debt.id]) debtPaymentSplitPlansByDebtId[debt.id] = effective[debt.id];\n  for (const id of aliases) delete billPaymentSplitPlansByBillId[id];\n  return { obligationSchedules, mortgageEscrowByDebtId, mortgageExtraPaymentByDebtId, loanBillPairingByDebtId, debtPaymentSplitPlansByDebtId, billPaymentSplitPlansByBillId };");
return s;
});
edit('src/screens/HomeScreen.tsx',s=>{
s=s.replace("import { getPlannedDebtInstallments }","import { getPlannedDebtInstallments, resolveUnifiedDebtSplitPlans }");
s=s.replace("  const historicalLoanBillIds = loanRuntime.aliases;","  const historicalLoanBillIds = loanRuntime.aliases;\n  const canonicalPlanAliases = Object.fromEntries(Object.entries(historicalLoanBillIds).filter(([id]) => !loanRuntime.legacyPairs[id] && !loanRuntime.excludedDebtIds.includes(id)));\n  const effectiveDebtSplitPlans = resolveUnifiedDebtSplitPlans(onboardingData.debtPaymentSplitPlansByDebtId, onboardingData.billPaymentSplitPlansByBillId, canonicalPlanAliases);");
s=s.replace("plans: onboardingData.debtPaymentSplitPlansByDebtId,","plans: effectiveDebtSplitPlans,");
s=s.replace("debtPaymentSplitPlansByDebtId={onboardingData.debtPaymentSplitPlansByDebtId}","debtPaymentSplitPlansByDebtId={effectiveDebtSplitPlans}");
s=s.replace("    await saveBudgetSettings({ debtPaymentSplitPlansByDebtId });","    const billPaymentSplitPlansByBillId = { ...(latestOnboardingRef.current.billPaymentSplitPlansByBillId ?? {}) };\n    for (const billIds of Object.values(canonicalPlanAliases)) for (const id of billIds) delete billPaymentSplitPlansByBillId[id];\n    await saveBudgetSettings({ debtPaymentSplitPlansByDebtId, billPaymentSplitPlansByBillId });");
return s;
});
edit('supabase/migrations/20261115054327_unified_loan_atomic_save.sql',s=>{
s=s.replaceAll("'mortgageExtraPaymentByDebtId','loanBillPairingByDebtId'","'mortgageExtraPaymentByDebtId','loanBillPairingByDebtId','debtPaymentSplitPlansByDebtId','billPaymentSplitPlansByBillId'");
const marker="  v_old_relation := v_settings->'loanBillPairingByDebtId'->v_id;";
s=s.replace(marker,"  IF (COALESCE(p_settings->'debtPaymentSplitPlansByDebtId','{}') - v_id) IS DISTINCT FROM\n     (COALESCE(v_settings->'debtPaymentSplitPlansByDebtId','{}') - v_id) THEN\n    RAISE EXCEPTION 'Unrelated loan split plan changed' USING ERRCODE = '22023';\n  END IF;\n"+marker);
const marker2="  v_schedule := p_settings->'obligationSchedules'->('debt:' || v_id);";
s=s.replace(marker2,"  IF (COALESCE(p_settings->'billPaymentSplitPlansByBillId','{}') - COALESCE(v_old_relation->>'billId','')) IS DISTINCT FROM\n     (COALESCE(v_settings->'billPaymentSplitPlansByBillId','{}') - COALESCE(v_old_relation->>'billId','')) THEN\n    RAISE EXCEPTION 'Unrelated bill split plan changed' USING ERRCODE = '22023';\n  END IF;\n"+marker2);
return s;
});

