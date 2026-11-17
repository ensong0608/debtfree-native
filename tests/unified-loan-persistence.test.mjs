import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDefaultOnboardingData } from '../src/onboarding-domain.ts';
import { prepareUnifiedLoanSettings } from '../src/finance/unified-loan.ts';
import { SHARED_SETTINGS_FIELDS } from '../src/settings-contract.ts';

const mocks = new Map([
 ['react-native',"export const PermissionsAndroid={};export const Platform={OS:'android'};"],
 ['expo-secure-store',"export const WHEN_UNLOCKED_THIS_DEVICE_ONLY='device';export const getItemAsync=k=>globalThis.__loanFixture.cache.get(k)??null;export const setItemAsync=(k,v)=>{globalThis.__loanFixture.cache.set(k,v)};export const deleteItemAsync=k=>{globalThis.__loanFixture.cache.delete(k)};"],
 ['expo-crypto',"export const randomUUID=()=> 'synthetic-draft-id';"],
 ['./auth',"export const getSupabaseClient=()=>globalThis.__loanFixture.client;export const createSessionVerification=()=>({getUser:async()=>({id:'alice',user_metadata:{debtfree_native_v1:globalThis.__loanFixture.current}})});"],
 ['./finance-storage',"export const assertHouseholdFinanceContextReady=async()=>{};export const clearUserFinanceStorage=async()=>{};export const clearUserFinanceStorageForAccountDeletion=async()=>{};export const deleteAccountHistoryWithCommit=async()=>{};export const loadFinanceRecords=async()=>{throw Error('unexpected financial load')};"],
 ['./dev/local-acceptance',"export const isLocalAcceptanceOwner=()=>false;export const saveLocalAcceptanceFixture=async()=>{throw Error('not fixture')};"],
 ['./household-service',"export const loadVerifiedHouseholdContext=async()=>{throw Error('unexpected membership load')};"],
]);
registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/src/onboarding-storage.ts')&&mocks.has(specifier))return {url:'data:text/javascript,'+encodeURIComponent(mocks.get(specifier)),shortCircuit:true};
 if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.[a-z]+$/i.test(specifier)){
  const path=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(path)))return next(path.href,context);
 }
 return next(specifier,context);
}});
const {upsertUserDebt}=createRequire(import.meta.url)('../src/onboarding-storage.ts');
let f;
const loan={id:'00000000-0000-4000-8000-000000000001',name:'Synthetic car',category:'Auto loan',balance:10000,originalBalance:12000,minimumPayment:1000,apr:5,dueDay:15,creditLimit:null,annualFeeAmount:null,annualFeeNextDueDate:null,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',serverVersion:2};
function settings(data){return {householdId:data.householdId,...Object.fromEntries(SHARED_SETTINGS_FIELDS.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]))};}
beforeEach(()=>{
 const current={...createDefaultOnboardingData('alice'),householdId:'shared',currencyCode:'USD',householdName:'Synthetic',settingsRevision:3,debts:[loan],householdContext:{userId:'alice',householdId:'shared',role:'owner',membershipVersion:'7'}};
 f=globalThis.__loanFixture={current,cache:new Map(),settings:settings(current),revision:3,row:null,calls:[],mode:'normal',readbacks:0};
 f.client={
  auth:{getSession:async()=>({data:{session:{user:{id:'alice'}}},error:null}),getUser:async()=>({data:{user:{id:'alice',user_metadata:{debtfree_native_v1:current}}},error:null})},
  from(table){assert.equal(table,'debts');return {select(){return this},eq(){return this},async maybeSingle(){f.readbacks++;return {data:f.row,error:null}}};},
  async rpc(name,args){
   f.calls.push(name);
   f.lastArgs=args;
   if(name==='debtfree_get_household_settings')return {data:{status:'ok',householdId:'shared',role:'owner',membershipVersion:'7',revision:f.revision,settings:f.settings},error:null};
   assert.equal(name,'debtfree_upsert_household_loan_atomic','must never fall back to a sequential save');
   assert.equal(args.p_expected_settings_revision,3);
   assert.equal(args.p_expected_version,2);
   assert.equal(args.p_idempotency_key,loan.id);
   if(f.mode==='missing')return {data:null,error:{code:'PGRST202',message:'missing RPC'}};
   if(f.mode==='reject')return {data:null,error:{code:'42501',message:'denied'}};
   f.row={...args.p_debt,version:3,created_at:loan.createdAt,updated_at:'2026-11-14T00:00:00Z'};
   if(f.mode!=='row-only'){f.settings=structuredClone(args.p_settings);f.revision=4;}
   if(f.mode==='row-only'||f.mode==='lost')return {data:null,error:{message:'response lost'}};
   if(f.mode==='throw-after-commit')throw Error('disconnected');
   if(f.mode==='wrong-row')f.row={...f.row,minimum_payment:'5'};
   return {data:{success:true,householdId:'shared',membershipVersion:'7',row:f.row,revision:f.revision,settings:f.settings},error:null};
  }
 };
});
function save(){
 const debt={...loan,minimumPayment:1200,dueDay:20};
 const patch=prepareUnifiedLoanSettings({current:f.current,debt,bills:[],today:'2026-11-14',currency:'USD'});
 return upsertUserDebt(f.current,debt,patch);
}

test('loan terms and schedule use exactly one atomic RPC and return the proven revision',async()=>{
 const saved=await save();
 assert.deepEqual(f.calls,['debtfree_upsert_household_loan_atomic']);
 assert.equal(saved.debts[0].minimumPayment,1200);assert.equal(saved.settingsRevision,4);
 assert.equal(saved.obligationSchedules['debt:'+loan.id].terms.at(-1).amount.minorUnits,120000);
});
test('lost response succeeds only after both debt and settings are proven',async()=>{
 f.mode='lost';const saved=await save();assert.equal(saved.settingsRevision,4);assert.equal(f.readbacks,1);
 assert.deepEqual(f.calls,['debtfree_upsert_household_loan_atomic','debtfree_get_household_settings']);
});
test('thrown transport failure after commit follows the same exact readback path',async()=>{
 f.mode='throw-after-commit';const saved=await save();assert.equal(saved.settingsRevision,4);assert.equal(f.readbacks,1);
});
test('matching debt row alone never reports success and preserves the prior local data',async()=>{
 f.mode='row-only';await assert.rejects(save(),{name:'FinancialSettingsUncertainError'});
 assert.equal(f.current.debts[0].minimumPayment,1000);assert.equal(f.current.settingsRevision,3);
});
test('missing deployment fails closed without sequential fallback or misleading readback success',async()=>{
 f.mode='missing';await assert.rejects(save(),{name:'OnboardingDataUnavailableError'});
 assert.deepEqual(f.calls,['debtfree_upsert_household_loan_atomic']);assert.equal(f.readbacks,0);
});
test('confirmed authorization rejection does not masquerade as an uncertain partial commit',async()=>{
 f.mode='reject';await assert.rejects(save(),{name:'DebtWriteFailedError'});assert.equal(f.readbacks,0);
});
test('even a successful receipt cannot confirm different debt terms',async()=>{
 f.mode='wrong-row';await assert.rejects(save(),{name:'DebtWriteUncertainError'});
});

test('legacy conversion requires a server bill revision and sends the reviewed snapshot',async()=>{
 const bill={id:'legacy-bill',name:'Old vehicle',category:'other_bill',amount:{currency:'USD',minorUnits:100000},dueDay:15,paymentMethod:'debit',autoPost:false,active:true,createdAt:loan.createdAt,updatedAt:loan.updatedAt};
 f.current.loanBillPairingByDebtId={[loan.id]:{status:'linked',billId:bill.id}};
 const patch=prepareUnifiedLoanSettings({current:f.current,debt:loan,bills:[bill],today:'2026-11-14',currency:'USD'});
 await assert.rejects(upsertUserDebt(f.current,loan,patch),{name:'OnboardingDataUnavailableError'});
 assert.equal(f.calls.length,0);
 const saved=await upsertUserDebt(f.current,loan,patch,bill);
 assert.equal(f.lastArgs.p_legacy_bill_proof.updatedAt,bill.updatedAt);
 assert.equal(f.lastArgs.p_legacy_bill_proof.amountMinor,100000);
 assert.equal(saved.loanBillPairingByDebtId[loan.id].canonical,true);
 assert.equal(saved.loanBillPairingByDebtId[loan.id].billId,bill.id);
});
