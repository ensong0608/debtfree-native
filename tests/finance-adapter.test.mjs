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
 assert.equal(plan.status,'paidOff'); assert.equal(plan.totalDebt,100); assert.equal(plan.totalMinimums,50); assert.equal(plan.monthsToPayoff,2); assert.equal(plan.debtFreeDateLabel,'Jan 2027'); assert.deepEqual(plan.payoffOrder.map(x=>x.id),['card','auto']); assert.equal(plan.payoffOrder[0].projectedPayoffLabel,'Jan 2027'); const one=d.calculatePayoffPlan([debt('only','Auto loan',40,40)],'snowball',0,now); assert.equal(one.debtFreeDateLabel,'Dec 2026');
});
