import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const d = require('../src/onboarding-domain.ts');
const { parseMoney } = require('../src/finance/money.ts');
const debt = (id, category, balance, minimumPayment) => ({ id, name:id, category, balance, originalBalance:balance, apr:0, minimumPayment, dueDay:null, creditLimit:null, createdAt:'', updatedAt:'' });
test('literal edits, strict commits and currency scales', () => {
 let value=''; for (const next of ['4','42','425','425.','425.2','425.25']) { value=d.acceptMoneyEdit(value,next); assert.equal(value,next); }
 assert.equal(parseMoney(value,'USD').minorUnits,42525); assert.equal(d.formatCurrency(d.parseMoneyInput(value),'USD'),'$425.25');
 assert.equal(d.acceptMoneyEdit('425.2','425.2.'),'425.2'); assert.equal(d.acceptMoneyEdit('425','4.25.25'),'425'); assert.equal(d.parseMoneyInput('425.'),null);
 for (const [code,text,minor] of [['JPY','123',123],['KWD','1.234',1234],['CLF','1.2345',12345]]) { assert.equal(parseMoney(text,code).minorUnits,minor); assert.equal(d.parseMoneyInput(text,code),Number(text)); assert.ok(d.formatCurrency(Number(text),code).endsWith(text)); }
 assert.equal(d.acceptMoneyEdit('1','1.','JPY'),'1'); assert.equal(d.CURRENCY_OPTIONS.length,165); assert.deepEqual(d.CURRENCY_OPTIONS.slice(0,3).map(x=>x.code),['USD','EUR','GBP']); assert.equal(d.resolveCurrencyOption({currencyCode:'EUR'}).symbol,'\u20ac');
 assert.equal(d.normalizeMonthlyIncome(1.234, 'monthly', 'KWD'), 1.234);
 assert.equal(d.normalizeMonthlyIncome(1.2345, 'monthly', 'CLF'), 1.2345);
 assert.equal(d.normalizeMonthlyIncome(1, 'weekly', 'JPY'), 4);
 assert.equal(d.calculateTotalMonthlyIncome(1.234, 'monthly', [{amount: 1.234, frequency:'monthly'}], 'KWD'), 2.468);
});
test('next local month and mortgage exclusion with independent expected payoff', () => {
 const now=new Date('2026-11-04T12:00:00Z'); assert.equal(d.defaultFirstPaymentDate(now),'2026-12-01'); assert.equal(d.defaultFirstPaymentDate(new Date('2026-12-01T07:30:00Z'),'America/Los_Angeles'),'2026-12-01');
 const plan=d.calculatePayoffPlan([debt('mortgage','Mortgage',1000,500),debt('auto','Auto loan',60,30),debt('card','Credit card',40,20)],'snowball',0,now);
 assert.equal(plan.status,'paidOff'); assert.equal(plan.totalDebt,100); assert.equal(plan.totalMinimums,50); assert.equal(plan.monthsToPayoff,2); assert.equal(plan.debtFreeDateLabel,'Entered debts projected paid off: Jan 2027'); assert.deepEqual(plan.payoffOrder.map(x=>x.id),['card','auto']); assert.equal(plan.payoffOrder[0].projectedPayoffLabel,'Jan 2027'); const one=d.calculatePayoffPlan([debt('only','Auto loan',40,40)],'snowball',0,now); assert.equal(one.debtFreeDateLabel,'Entered debts projected paid off: Dec 2026');
});
test('zero and signed credit balances are tracked but cannot claim household debt freedom', () => {
 const z = debt('zero', 'Credit card', 0, 0);
 const c = debt('credit', 'Credit card', -25, 0);
 const noAccount = d.calculatePayoffPlan([], 'snowball', 30);
 const onlyZero = d.calculatePayoffPlan([z, c], 'snowball', 30);
 assert.equal(noAccount.status, 'insufficientData');
 assert.equal(noAccount.progressPercent, 0);
 assert.equal(noAccount.monthlyTotalPayment, 0);
 assert.ok(!/debt-free now/i.test(noAccount.debtFreeDateLabel));
 assert.equal(onlyZero.status, 'insufficientData');
 assert.equal(onlyZero.totalDebt, 0);
 assert.equal(onlyZero.monthlyTotalPayment, 0);
 assert.match(onlyZero.debtFreeDateLabel, /entered accounts/);
 assert.equal(d.calculateBalanceSnapshot([debt('owed','Credit card',100,10),c]).balance, 100);
 assert.equal(d.calculateBalanceSnapshot([c]).percent, 0);
 assert.deepEqual(d.sortDebtsByStrategy([z,c], 'snowball'), []);
});
test('account input allows zero or credit balance without inventing payments', () => {
 const draft = (balanceRaw, minimumPaymentRaw) => ({name:'Card',category:'Credit card', balanceRaw,minimumPaymentRaw,aprRaw:'12.5',originalBalanceRaw:'', dueDayRaw:'',creditLimitRaw:''});
 let result = d.validateDebtDraft(draft('0', '0')); assert.equal(result.valid, true); assert.equal(result.debt.balance, 0);
 result = d.validateDebtDraft(draft('-10.25', '0')); assert.equal(result.valid, true); assert.equal(result.debt.balance, -10.25);
 assert.equal(d.validateDebtDraft(draft('100', '0')).valid, false);
 assert.equal(d.validateDebtDraft(draft('0', '-1')).valid, false);
 assert.equal(d.acceptMoneyEdit('', '-', 'USD', true), '-');
 assert.equal(d.acceptMoneyEdit('-', '-10.25', 'USD', true), '-10.25');
});
