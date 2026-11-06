import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {canonicalDebtAmount,canonicalOptionalDebtAmount,decodeDebtAmount,assertCurrencyChangeAllowed,resolveDatabaseDebtCategory}=require('../src/debt-storage-domain.ts');
const {createDefaultOnboardingData,resolveCurrencyOption}=require('../src/onboarding-domain.ts');
test('canonical API strings roundtrip at each currency scale',()=>{
 for(const [code,value,wire,padded] of [['USD',12.34,'12.34','12.3400'],['JPY',123,'123','123.0000'],['KWD',1.234,'1.234','1.2340'],['CLF',1.2345,'1.2345','1.2345']]) { assert.equal(canonicalDebtAmount(value,code),wire); assert.equal(decodeDebtAmount(padded,code),value); }
 assert.equal(canonicalOptionalDebtAmount(null,'USD'),null); assert.equal(canonicalOptionalDebtAmount(1.234,'KWD'),'1.234');
 for(const [code,value] of [['USD','1.2340'],['JPY','1.0001'],['KWD','1.2341'],['CLF','1.23451'],['USD',null],['USD',''],['USD','1e2']]) assert.throws(()=>decodeDebtAmount(value,code));
});
test('selected metadata currency persists and existing monetary records cannot be relabeled',()=>{
 const data=createDefaultOnboardingData('test'); data.currencyCode='KWD'; const loaded=JSON.parse(JSON.stringify(data)); const empty={transactions:[],recurringBills:[],reconciliationAnchors:[],complete:true}; assert.equal(resolveCurrencyOption(loaded).code,'KWD'); assert.throws(()=>assertCurrencyChangeAllowed(loaded,'CLF')); assert.doesNotThrow(()=>assertCurrencyChangeAllowed(loaded,'CLF',empty)); loaded.primaryIncomeAmount=1.234; assert.throws(()=>assertCurrencyChangeAllowed(loaded,'CLF',empty)); assert.doesNotThrow(()=>assertCurrencyChangeAllowed(loaded,'KWD',empty)); loaded.primaryIncomeAmount=0; loaded.debts=[{id:'mortgage'}]; assert.throws(()=>assertCurrencyChangeAllowed(loaded,'USD',empty));
});
test('signed balances are preserved; nonbalance amounts remain nonnegative', () => {
  assert.equal(canonicalDebtAmount('-20.50', 'USD', true), '-20.50');
  assert.equal(decodeDebtAmount('-20.5000', 'USD', true), -20.5);
  assert.equal(canonicalDebtAmount(-0.25, 'USD', true), '-0.25');
  assert.equal(canonicalDebtAmount(0, 'USD', true), '0.00');
  assert.throws(() => canonicalDebtAmount('-20.50', 'USD'));
  assert.throws(() => canonicalOptionalDebtAmount(-1, 'USD'));
  assert.throws(() => canonicalDebtAmount('-1.234', 'USD', true));
});


test('authoritative database category wins over stale metadata and preserves valid roles', () => {
  assert.equal(resolveDatabaseDebtCategory('Credit card', 'Auto loan'), 'Credit card');
  assert.equal(resolveDatabaseDebtCategory('Auto loan', 'Credit card'), 'Auto loan');
  assert.equal(resolveDatabaseDebtCategory('Mortgage', 'Credit card'), 'Mortgage');
  assert.equal(resolveDatabaseDebtCategory(null, 'Medical debt'), 'Medical debt');
  assert.throws(() => resolveDatabaseDebtCategory('outdated-category', 'Auto loan'));
  assert.throws(() => resolveDatabaseDebtCategory(null));
});
