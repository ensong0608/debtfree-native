import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultOnboardingData } from '../src/onboarding-domain.ts';
import { prepareUnifiedLoanSettings } from '../src/finance/unified-loan.ts';
import { unifiedLoanRuntime, hasUnresolvedLegacyLoanLinks, validateDivergentLinkResolution, historicalBillIdsByDebtId } from '../src/finance/loan-bill-pairing.ts';
import { getScheduledObligationRows, paymentMatchesObligation, findUnassignedPaymentsForObligation } from '../src/finance/payment-matching.ts';
import { getPlannedDebtInstallments, resolveUnifiedDebtSplitPlans } from '../src/finance/debt-payment-split.ts';
import { getObligationCycle } from '../src/finance/obligation-schedule.ts';
import { calculateMonthlyCashflow, calculateCategoryBreakdown, selectCardDebtCommitment } from '../src/finance/budget.ts';
import { createNativeBackup, parseNativeBackup } from '../src/finance/backup.ts';
import { makeMoney } from '../src/finance/money.ts';

const loan = { id: 'loan-1', name: 'Vehicle loan', category: 'Auto loan', balance: 12000, originalBalance: 20000, minimumPayment: 1000, apr: 5, dueDay: 15, creditLimit: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', serverVersion: 2 };
const bill = { id: 'legacy-bill', name: 'Old vehicle name', category: 'other_bill', amount: makeMoney('USD',100000), dueDay: 15, paymentMethod: 'debit', active: true, autoPost: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
const billSchedule = { firstDueDate: '2026-10-15', acknowledgedPaidCycles: ['2026-10'], terms: [{ effectiveMonth: '2026-10', dueDay: 15, amount: bill.amount }] };
const billPlan = { terms: [{ effectiveMonth: '2026-10', day1: 1, day2: 10 }] };
function fixture(debts=[loan]) {
  return { ...createDefaultOnboardingData('synthetic'), currencyCode: 'USD', householdTimeZone: 'UTC', debts,
    loanBillPairingByDebtId: { [loan.id]: { status: 'linked', billId: bill.id } },
    obligationSchedules: { ['bill:'+bill.id]: billSchedule },
    billPaymentSplitPlansByBillId: { [bill.id]: billPlan }, debtPaymentSplitPlansByDebtId: {} };
}
function rowsFor(data, transactions=[]) {
  const runtime = unifiedLoanRuntime({ debts:data.debts, bills:[bill], pairings:data.loanBillPairingByDebtId, archived:data.archivedPaidOffDebtIds, currency:'USD' });
  return getScheduledObligationRows({ debts:data.debts.filter(d=>!runtime.excludedDebtIds.includes(d.id)), recurringBills:[bill], transactions, asOfDate:'2026-11-14', currencyCode:'USD', schedules:data.obligationSchedules, loanBillPairs:runtime.legacyPairs, excludedBillIds:runtime.excludedBillIds, historicalBillIdsByDebtId:runtime.aliases });
}
function transaction(patch={}) {
  return { id:'bill:legacy-bill:2026-11-15', accountId:null, date:'2026-11-10', appliesToDate:'2026-11-15', amount:bill.amount, category:'debit_bill', payee:'Old vehicle name', memo:'[bill:legacy-bill]', source:'recurring_bill', reconciled:false, createdAt:'2026-11-10T00:00:00Z', deletedAt:null, ...patch };
}

test('new mortgage and auto use one account and one Budget commitment without a bill',()=>{
  for (const category of ['Mortgage','Auto loan']) {
    const current={...fixture([]),loanBillPairingByDebtId:{},obligationSchedules:{},billPaymentSplitPlansByBillId:{}};
    const debt={...loan,category,createdAt:'2026-11-14T00:00:00Z'};
    const patch=prepareUnifiedLoanSettings({current,debt,bills:[],today:'2026-11-14',currency:'USD'});
    assert.deepEqual(patch.loanBillPairingByDebtId,{});
    assert.equal(getObligationCycle(patch.obligationSchedules['debt:'+debt.id],'2026-11').amount.minorUnits,100000);
    const cash=calculateMonthlyCashflow({monthlyIncome:4000,recurringBills:[],monthlyDebtPlanPayment:0,unifiedLoans:[debt],currencyCode:'USD'});
    assert.equal(cash.totalCommitments,1000);
    const categories=calculateCategoryBreakdown({monthlyIncome:4000,recurringBills:[],monthlyDebtPlanPayment:0,unifiedLoans:[debt],currencyCode:'USD'});
    assert.equal(categories.find(c=>c.categoryKey===(category==='Mortgage'?'housing':'custom:transportation')).amount,1000);
  }
});

test('conversion preserves bill history, acknowledgements and split terms; edits apply only to future cycles',()=>{
  const current=fixture();
  current.debtPaymentSplitPlansByDebtId={ [loan.id]:{terms:[{effectiveMonth:'2026-12',day1:2,day2:7,count:3,day3:12}]} };
  const debt={...loan,minimumPayment:1200,dueDay:20};
  const patch=prepareUnifiedLoanSettings({current,debt,bills:[bill],today:'2026-11-14',currency:'USD'});
  assert.equal(patch.loanBillPairingByDebtId[loan.id].billId,bill.id);
  assert.equal(patch.loanBillPairingByDebtId[loan.id].canonical,true);
  assert.deepEqual(patch.billPaymentSplitPlansByBillId,{});
  assert.deepEqual(patch.debtPaymentSplitPlansByDebtId[loan.id].terms.map(t=>t.effectiveMonth),['2026-10','2026-12']);
  const schedule=patch.obligationSchedules['debt:'+loan.id];
  assert.equal(schedule.firstDueDate,'2026-10-15');
  assert.equal(getObligationCycle(schedule,'2026-10').acknowledgedPaid,true);
  assert.equal(getObligationCycle(schedule,'2026-11').amount.minorUnits,100000);
  assert.equal(getObligationCycle(schedule,'2026-12').amount.minorUnits,120000);
  assert.equal(getObligationCycle(schedule,'2026-12').dueDate,'2026-12-20');
  const saved={...current,...patch,debts:[debt]};
  const november=rowsFor(saved,[transaction()]).filter(r=>r.dueCycleMonth==='2026-11');
  assert.equal(november.length,1);
  assert.equal(november[0].kind,'debt');
  assert.equal(november[0].state.status,'paid');
  const events=getPlannedDebtInstallments({rows:rowsFor(saved),plans:patch.debtPaymentSplitPlansByDebtId,billPlans:patch.billPaymentSplitPlansByBillId,historicalBillIdsByDebtId:historicalBillIdsByDebtId(patch.loanBillPairingByDebtId),transactions:[],asOfDate:'2026-11-14'});
  assert.equal(events.filter(e=>e.cycleMonth==='2026-11').length,2);
  assert.equal(events.filter(e=>e.cycleMonth==='2026-12').length,3);
  assert.equal(hasUnresolvedLegacyLoanLinks(unifiedLoanRuntime({debts:[debt],bills:[bill],pairings:patch.loanBillPairingByDebtId,currency:'USD'}).audit),false);
});

test('historical bill matching rejects conflicting account, bill, currency and due cycle',()=>{
  const obligation={kind:'debt',id:'minimum:'+loan.id,accountId:loan.id,dueDate:'2026-11-15',dueCycleMonth:'2026-11',requiredAmount:bill.amount,historicalBillIds:[bill.id]};
  assert.equal(paymentMatchesObligation(transaction(),obligation),true);
  for (const tx of [
    transaction({accountId:'another-loan',category:'payment'}),
    transaction({memo:'[bill:legacy-bill] [bill:other]'}),
    transaction({amount:makeMoney('EUR',100000)}),
    transaction({appliesToDate:'2026-12-15'}),
  ]) assert.equal(paymentMatchesObligation(tx,obligation),false);
  assert.equal(findUnassignedPaymentsForObligation(obligation,[transaction({accountId:'another-loan',category:'payment',appliesToDate:null})]).length,0);
});

test('ambiguous ownership suppresses affected reminders and exposes unresolved aggregate status',()=>{
  const other={...loan,id:'loan-2'};
  const data=fixture([loan,other]);
  data.loanBillPairingByDebtId[other.id]={status:'linked',billId:bill.id};
  const runtime=unifiedLoanRuntime({debts:data.debts,bills:[bill],pairings:data.loanBillPairingByDebtId,currency:'USD'});
  assert.equal(hasUnresolvedLegacyLoanLinks(runtime.audit),true);
  assert.deepEqual(runtime.excludedDebtIds.sort(),[loan.id,other.id]);
  assert.deepEqual(runtime.excludedBillIds,[bill.id]);
  assert.deepEqual(rowsFor(data),[]);
  assert.deepEqual(runtime.aliases,{});
});

test('escrow, currency and due-day conflicts reject before producing a save payload',()=>{
  const current=fixture();
  assert.throws(()=>prepareUnifiedLoanSettings({current,debt:{...loan,dueDay:null},bills:[bill],today:'2026-11-14',currency:'USD'}),/due day/i);
  const mortgage={...loan,category:'Mortgage',minimumPayment:1000};
  const mortgageBill={...bill,category:'housing',amount:makeMoney('USD',40000)};
  const link={debt:mortgage,bill:mortgageBill,amountDiffers:true,dueDayDiffers:false};
  assert.equal(validateDivergentLinkResolution({link,mode:'use_bill',currencyCode:'USD',mortgageEscrowByDebtId:{[loan.id]:500}}).valid,false);
  assert.equal(validateDivergentLinkResolution({link:{...link,bill:{...mortgageBill,amount:makeMoney('EUR',40000)}},mode:'use_bill',currencyCode:'USD'}).valid,false);
  assert.throws(()=>prepareUnifiedLoanSettings({current:fixture([mortgage]),debt:mortgage,bills:[{...bill,category:'housing'}],today:'2026-11-14',currency:'USD',escrow:1100}),/escrow/i);
});

test('canonical alias survives an inactive legacy bill and clearing a migrated split does not resurrect it',()=>{
  const current=fixture();
  const patch=prepareUnifiedLoanSettings({current,debt:loan,bills:[bill],today:'2026-11-14',currency:'USD'});
  const runtime=unifiedLoanRuntime({debts:[loan],bills:[{...bill,active:false}],pairings:patch.loanBillPairingByDebtId,currency:'USD'});
  assert.deepEqual(runtime.aliases[loan.id],[bill.id]);
  assert.equal(hasUnresolvedLegacyLoanLinks(runtime.audit),false);
  assert.equal(resolveUnifiedDebtSplitPlans({},patch.billPaymentSplitPlansByBillId,runtime.aliases)[loan.id],undefined);
  assert.equal(selectCardDebtCommitment([{...loan,category:'Personal loan'}],0,'USD').total,0);
});

test('canonical legacy identity and migrated split history survive a backup roundtrip',()=>{
 const current=fixture();
 const patch=prepareUnifiedLoanSettings({current,debt:loan,bills:[bill],today:'2026-11-14',currency:'USD'});
 const data={...current,...patch};
 const owner={userId:data.userId,householdId:data.householdId};
 const backup=createNativeBackup({userId:data.userId,householdId:data.householdId,currency:'USD',exportedAt:'2026-11-14T00:00:00Z',onboardingData:data,recurringBills:[bill],transactions:[transaction()],reconciliationAnchors:[]},owner);
 const parsed=parseNativeBackup(JSON.stringify(backup),owner).backup;
 assert.deepEqual(parsed.onboardingData.loanBillPairingByDebtId,data.loanBillPairingByDebtId);
 assert.deepEqual(parsed.onboardingData.debtPaymentSplitPlansByDebtId,data.debtPaymentSplitPlansByDebtId);
 assert.equal(rowsFor(parsed.onboardingData,parsed.transactions).filter(row=>row.dueCycleMonth==='2026-11')[0].state.status,'paid');
 const invalid=structuredClone(backup);invalid.onboardingData.loanBillPairingByDebtId[loan.id].canonical='yes';
 assert.throws(()=>parseNativeBackup(JSON.stringify(invalid),owner));
});
