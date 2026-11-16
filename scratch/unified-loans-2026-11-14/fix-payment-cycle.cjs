const fs=require('fs');
for(const path of ['src/screens/TransactionsScreen.tsx','src/screens/DebtScreen.tsx']){
 let s=fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n');
 s=s.replace("import { type ObligationSchedules }","import { getObligationCycle, type ObligationSchedules }");
 if(path.includes('TransactionsScreen')){
 s=s.replace('createDebtMinimumPaymentTransaction, getScheduledObligationRows,','createDebtMinimumPaymentTransaction, getScheduledObligationRows, resolveEffectiveDebtSchedule,');
 s=s.replace('  const dueCycleOptions:',"  const selectedDebtSchedule = selectedDebt ? resolveEffectiveDebtSchedule(obligationSchedules, selectedDebt.id, historicalBillIdsByDebtId?.[selectedDebt.id]) : undefined;\n  const dueCycleOptions:");
 s=s.replace('? [0, 1, 2].map(monthOffset => {','? [0, 1, 2].flatMap(monthOffset => {');
 s=s.replace("          const cycleDay = selectedDebt.dueDay ?? Number(newDate.slice(-2));\n          const date = resolveRecurringBillDate(month, cycleDay);","          const cycle = selectedDebtSchedule ? getObligationCycle(selectedDebtSchedule, month) : undefined;\n          if (cycle === null || (!selectedDebtSchedule && !selectedDebt.dueDay)) return [];\n          const date = cycle?.dueDate ?? resolveRecurringBillDate(month, selectedDebt.dueDay!);");
 }else{
 s=s.replace("import type { DebtDetailsDraft }","import { resolveEffectiveDebtSchedule } from '../finance/payment-matching';\nimport type { DebtDetailsDraft }");
 s=s.replace('  recurringBills = [], loanBillPairings = {},','  recurringBills = [], loanBillPairings = {}, obligationSchedules,');
 s=s.replace("        const dueCycleOptions:","        const schedule = resolveEffectiveDebtSchedule(obligationSchedules, selected.id, identityLinkedPairs[selected.id] ? [identityLinkedPairs[selected.id]] : []);\n        const dueCycleOptions:");
 s=s.replace('...[0, 1, 2].map(monthOffset => {','...[0, 1, 2].flatMap(monthOffset => {');
 s=s.replace("            const cycleDay = selected.dueDay ?? Number(accountTxDate.slice(-2));\n            const date = resolveRecurringBillDate(month, cycleDay);","            const cycle = schedule ? getObligationCycle(schedule, month) : undefined;\n            if (cycle === null || (!schedule && !selected.dueDay)) return [];\n            const date = cycle?.dueDate ?? resolveRecurringBillDate(month, selected.dueDay!);");
 }
 // Existing files use CRLF; account for matching by normalizing first in invocation.
 fs.writeFileSync(path,s);
}
