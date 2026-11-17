const fs = require('fs');
const assert = require('node:assert/strict');
const { PGlite } = require('./sql-test-runtime/node_modules/@electric-sql/pglite');
(async () => {
 const db = new PGlite();
 await db.exec(
  "CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; " +
  "CREATE TABLE public.household_settings(household_id text PRIMARY KEY, revision bigint NOT NULL, settings jsonb NOT NULL); " +
  "CREATE TABLE public.recurring_bills(id text,household_id text,updated_at timestamptz,amount numeric,due_day integer,payment_method text,category text,active boolean); " +
  "CREATE TABLE public.test_debts(id uuid PRIMARY KEY, version bigint NOT NULL, payload jsonb NOT NULL); " +
  "CREATE FUNCTION public.debtfree_internal_finance_authorize(text,bigint,text[], OUT r_actor uuid, OUT r_role text, OUT r_membership_version bigint, OUT r_currency text, OUT r_household_name text) RETURNS record LANGUAGE plpgsql AS $$ BEGIN IF current_setting('test.role',true) = 'viewer' OR $2 <> 7 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501'; END IF; r_actor:='00000000-0000-4000-8000-000000000099'; r_role:='owner'; r_membership_version:=7; r_currency:='USD'; r_household_name:='Synthetic'; END $$; " +
  "CREATE FUNCTION public.debtfree_internal_currency_scale(text) RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$; " +
  "CREATE FUNCTION public.debtfree_save_household_settings(text,bigint,bigint,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN UPDATE public.household_settings SET settings=$4, revision=revision+1 WHERE household_id=$1 AND revision=$2; IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF; RETURN jsonb_build_object('status','saved'); END $$; " +
  "CREATE FUNCTION public.debtfree_upsert_household_debt_atomic(text,bigint,jsonb,bigint,text) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE v bigint; BEGIN IF $3->>'name'='reject-debt' THEN RAISE EXCEPTION 'synthetic debt rejection' USING ERRCODE='23514'; END IF; SELECT version INTO v FROM public.test_debts WHERE id=($3->>'id')::uuid; IF v IS DISTINCT FROM $4 THEN RAISE EXCEPTION 'stale debt'; END IF; INSERT INTO public.test_debts VALUES(($3->>'id')::uuid,COALESCE(v,0)+1,$3) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,payload=EXCLUDED.payload; RETURN jsonb_build_object('success',true,'householdId',$1,'membershipVersion','7','row',$3); END $$;"
 );
 await db.exec(fs.readFileSync('supabase/migrations/20261115230945_unified_loan_atomic_save.sql','utf8'));
 const id = '00000000-0000-4000-8000-000000000001';
 const initial = {householdId:'h1',householdName:'Synthetic',currencyCode:'USD',loanBillPairingByDebtId:{[id]:{status:'linked',billId:'b1'}},obligationSchedules:{},mortgageEscrowByDebtId:{},mortgageExtraPaymentByDebtId:{},debtPaymentSplitPlansByDebtId:{},billPaymentSplitPlansByBillId:{}};
 const debt = {id,name:'Synthetic loan',category:'Mortgage',balance:'10000',apr:4,minimum_payment:'1000',due_day:15,household_id:'h1'};
 const desired = {...initial,loanBillPairingByDebtId:{[id]:{status:'linked',billId:'b1',canonical:true}},obligationSchedules:{['debt:'+id]:{firstDueDate:'2026-11-15',acknowledgedPaidCycles:[],terms:[{effectiveMonth:'2026-11',dueDay:15,amount:{currency:'USD',minorUnits:100000}}]}}};
 const reset = async () => {await db.query("DELETE FROM public.test_debts"); await db.query("DELETE FROM public.household_settings"); await db.query("INSERT INTO public.household_settings VALUES('h1',3,$1)",[JSON.stringify(initial)]); await db.exec("SET test.role='owner';DELETE FROM public.recurring_bills;INSERT INTO public.recurring_bills VALUES('b1','h1','2026-11-01T00:00:00Z',1000,15,'debit','housing',true)");};
 const proof={id:'b1',updatedAt:'2026-11-01T00:00:00Z',amountMinor:100000,currency:'USD',dueDay:15,paymentMethod:'debit',category:'housing',active:true};
 const call = (d=debt,s=desired,revision=3,version=null) => db.query("SELECT public.debtfree_upsert_household_loan_atomic('h1',7,$1::jsonb,$2::bigint,$3, $4::bigint,$5::jsonb,$6::jsonb) AS receipt",[JSON.stringify(d),version,id,revision,JSON.stringify(s),JSON.stringify(proof)]);
 let passed=0;
 await reset();
 const result=(await call()).rows[0].receipt;
 assert.equal(result.success,true); assert.equal(result.revision,4); assert.deepEqual(result.settings,desired); passed++;
 // A later debt rejection must roll back the already-attempted settings update.
 await reset();
 await assert.rejects(call({...debt,name:'reject-debt'}),/synthetic debt rejection/);
 assert.equal((await db.query("SELECT revision FROM public.household_settings")).rows[0].revision,3);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.test_debts")).rows[0].n,0); passed++;
 await reset(); await assert.rejects(call(debt,desired,2),/Stale loan settings/); passed++;
 await reset(); await db.exec("SET test.role='viewer'"); await assert.rejects(call(),/denied/); passed++;
 await reset(); await assert.rejects(call({...debt,due_day:null}),/due day/); passed++;
 await reset(); await assert.rejects(call(debt,{...desired,mortgageEscrowByDebtId:{[id]:1001}}),/escrow/); passed++;
 await reset(); await assert.rejects(call(debt,{...desired,loanBillPairingByDebtId:{}}),/Historical loan identity/); passed++;
 await reset(); await assert.rejects(call(debt,{...desired,householdName:'Changed elsewhere'}),/Unrelated household settings/); passed++;
 await reset();
 const wrong=structuredClone(desired);wrong.obligationSchedules['debt:'+id].terms[0].amount.minorUnits=50000;
 await assert.rejects(call(debt,wrong),/latest schedule terms/);passed++;
 await reset();
 const wrongCurrency=structuredClone(desired);wrongCurrency.obligationSchedules['debt:'+id].terms[0].amount.currency='EUR';
 await assert.rejects(call(debt,wrongCurrency),/schedule terms/);passed++;
 await reset();
 await assert.rejects(call(debt,desired,3,5),/stale debt/);
 assert.equal((await db.query("SELECT revision FROM public.household_settings")).rows[0].revision,3);passed++;
 await reset();await db.exec("UPDATE public.recurring_bills SET updated_at='2026-11-02T00:00:00Z'");await assert.rejects(call(),/Legacy bill changed/);passed++;
 await reset();const badFirst=structuredClone(desired);badFirst.obligationSchedules['debt:'+id].firstDueDate='2026-11-17';await assert.rejects(call(debt,badFirst),/first due date/);passed++;
 console.log(JSON.stringify({runtime:'PGlite 0.5.16, in-memory synthetic PostgreSQL',checksPassed:passed,migration:'20261115230945_unified_loan_atomic_save.sql',scope:'actual wrapper SQL; nested authority and persistence interfaces are synthetic stubs; no hosted access'}));
 await db.close();
})().catch(e=>{console.error(e.message);process.exitCode=1});
