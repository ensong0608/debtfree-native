import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultOnboardingData } from '../src/onboarding-domain.ts';
import { createNativeBackup, parseNativeBackup, createRestorePlan, createBackupCheckpointRepository, nativeBackupLifecycleWarnings } from '../src/finance/backup.ts';
const owner={userId:'user',householdId:'house'};
const date='2026-11-07T00:00:00.000Z';
const money=n=>({currency:'USD',minorUnits:n});
function fixture(){
 const d={...createDefaultOnboardingData(owner.userId),householdId:owner.householdId,currencyCode:'USD',updatedAt:date,debts:[{id:'debt',name:'Card',category:'Credit card',balance:100,originalBalance:null,apr:12,minimumPayment:10,dueDay:7,creditLimit:null,createdAt:date,updatedAt:date},{id:'home',name:'Mortgage',category:'Mortgage',balance:100000,originalBalance:null,apr:5,minimumPayment:1000,dueDay:15,creditLimit:null,createdAt:date,updatedAt:date}],loanBillPairingByDebtId:{home:{status:'linked',billId:'housing'}},recurringBillCategoryLabelByBillId:{housing:'Transportation'},obligationSchedules:{'debt:debt':{firstDueDate:'2026-11-07',acknowledgedPaidCycles:['2026-11'],terms:[{effectiveMonth:'2026-11',dueDay:7,amount:money(1000)}]}}};
 return createNativeBackup({userId:owner.userId,householdId:owner.householdId,currency:'USD',exportedAt:date,onboardingData:d,transactions:[{id:'tx',accountId:'debt',date:'2026-11-07',amount:money(1000),category:'payment',payee:'Card',source:'manual',reconciled:true,createdAt:date,deletedAt:date,principalAmount:money(800),interestAmount:money(200)}],recurringBills:[{id:'bill',name:'Bill',category:'utilities',amount:money(500),dueDay:3,paymentMethod:'credit',creditAccountId:'debt',autoPost:true,active:true,createdAt:date},{id:'housing',name:'Home payment',category:'housing',amount:money(150000),dueDay:20,paymentMethod:'debit',autoPost:false,active:true,createdAt:date}],reconciliationAnchors:[{id:'anchor',accountId:'debt',asOfDate:'2026-11-07',verifiedBalance:money(9000),createdAt:date,createdAdjustmentId:'tx',coveredTransactionIds:['tx']}]},owner);
}
const clone=x=>JSON.parse(JSON.stringify(x));
test('roundtrip preserves every domain, schedule, custom category label, allocation and tombstone',()=>{const b=fixture(); assert.deepEqual(parseNativeBackup(JSON.stringify(b),owner).backup,b); assert.equal(parseNativeBackup(JSON.stringify(b),owner).backup.onboardingData.recurringBillCategoryLabelByBillId.housing,'Transportation'); const legacy={...b,schema:'debtfree-sandbox-snapshot-v1'}; assert.equal(parseNativeBackup(JSON.stringify(legacy),owner).warnings.length,1);});
test('rejects foreign, incomplete, unknown, malformed and mixed currency snapshots',()=>{ const b=fixture(); assert.throws(()=>parseNativeBackup(JSON.stringify(b),{...owner,userId:'other'}),/different user/); assert.throws(()=>parseNativeBackup(JSON.stringify(b),{...owner,householdId:'other'}),/different user/); for(const mutate of [x=>delete x.transactions,x=>x.schema='prototype',x=>x.reconciliationAnchors[0].coveredTransactionIds=['missing'],x=>x.recurringBills[0].amount.currency='CAD',x=>x.transactions[0].deletedAt='bad',x=>x.transactions.push(x.transactions[0]),x=>x.transactions[0].principalAmount.minorUnits=1.5,x=>{x.onboardingData.loanBillPairingByDebtId.home={status:'linked'}},x=>{x.onboardingData.recurringBillCategoryLabelByBillId.housing='   ' }]) {const x=clone(b); mutate(x); assert.throws(()=>parseNativeBackup(JSON.stringify(x),owner));} });
test('confirmed deletion or incompatible edits keep pairing metadata recoverable in exports',()=>{
 const original=fixture();
 const cases=[
  x=>{x.onboardingData.debts=x.onboardingData.debts.filter(row=>row.id!=='home');x.onboardingData.obligationSchedules['debt:home']={firstDueDate:'2026-11-07',acknowledgedPaidCycles:[],terms:[{effectiveMonth:'2026-11',dueDay:7,amount:money(1000)}]};},
  x=>{x.recurringBills=x.recurringBills.filter(row=>row.id!=='housing');x.onboardingData.obligationSchedules['bill:housing']={firstDueDate:'2026-11-07',acknowledgedPaidCycles:[],terms:[{effectiveMonth:'2026-11',dueDay:7,amount:money(1000)}]};},
  x=>{x.onboardingData.debts=x.onboardingData.debts.filter(row=>row.id!=='debt');},
  x=>{x.onboardingData.debts.find(row=>row.id==='home').category='Auto loan';},
  x=>{const bill=x.recurringBills.find(row=>row.id==='housing');bill.category='utilities';},
  x=>{const bill=x.recurringBills.find(row=>row.id==='housing');bill.paymentMethod='credit';bill.creditAccountId='debt';},
 ];
 for(const mutate of cases){
  const x=clone(original); mutate(x);
  const {schema,version,...input}=x;
  const backup=createNativeBackup(input,owner);
  const parsed=parseNativeBackup(JSON.stringify(backup),owner);
  assert.deepEqual(backup.onboardingData.loanBillPairingByDebtId, original.onboardingData.loanBillPairingByDebtId);
  assert.deepEqual(parsed.backup.onboardingData.loanBillPairingByDebtId, original.onboardingData.loanBillPairingByDebtId);
  assert.match(nativeBackupLifecycleWarnings(backup).join(' '),/preserved in this backup/);
  assert.match(parsed.warnings.join(' '),/preserved in this backup/);
 }
});
test('plan is deterministic and never silently overwrites same identity',()=>{const b=fixture(), incoming=clone(b); incoming.transactions[0].payee='changed'; incoming.recurringBills.push({...incoming.recurringBills[0],id:'another'}); const p=createRestorePlan(incoming,b,owner); assert.equal(p.operations.find(x=>x.id==='tx').action,'conflict'); assert.equal(p.operations.find(x=>x.id==='another').action,'create'); assert.equal(p.conflicts,1); assert.deepEqual(p,createRestorePlan(incoming,b,owner));});
test('checkpoint survives restart, retains pre-restore data and protects failed work',async()=>{const data=new Map(), store={getItem:async k=>data.get(k)??null,setItem:async(k,v)=>{data.set(k,v)},removeItem:async k=>{data.delete(k)}}; const b=fixture(); let repo=createBackupCheckpointRepository(store); await repo.begin(owner,b,b); await repo.update(owner,{status:'failed',cursor:1,error:'offline'}); repo=createBackupCheckpointRepository(store); const saved=await repo.load(owner); assert.equal(saved.status,'failed'); assert.equal(saved.cursor,1); assert.deepEqual(saved.before,b); await assert.rejects(repo.begin(owner,b,b),/acknowledgement/); await repo.begin(owner,b,b,{acknowledgeReplacement:true}); assert.equal((await repo.load(owner)).cursor,0);});
