import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { calculatePayoff, rankAcceleratedAccounts } = require('../src/finance/payoff.ts');
const m = (minorUnits, currency = 'USD') => ({ currency, minorUnits });
const context = { householdId: 'h', source: { id: 's', kind: 'manual' }, asOf: null, coverage: { status: 'complete', description: 'all' } };
const a = (accountId, balance, aprThousandths = 0, minimum = 0, inclusion = 'accelerated') => ({ accountId, balance: m(balance), aprThousandths, scheduledMinimum: minimum === null ? null : m(minimum), inclusion });
const input = (accounts, commitment, extra = 0) => ({ accounts: { status: 'available', data: accounts, context }, currency: 'USD', strategy: 'snowball', extraMonthlyPayment: m(extra), ...(commitment === undefined ? {} : { fixedMonthlyCommitment: m(commitment) }), assumptions: { firstPaymentDate: '2024-01-31', requestedDay: 31, householdTimeZone: 'America/Los_Angeles' } });
const n = x => x.minorUnits;
const run = (accounts, cap, extra) => calculatePayoff(input(accounts, cap, extra));
test('S1 and S8: zero interest, final cap, recurrence and conservation', () => {
  const r = run([a('A',10000)],3000);
  assert.equal(r.status,'paidOff'); assert.equal(r.monthsToPayoff,4);
  assert.deepEqual(r.schedule.map(p => n(p.totalPaid)),[3000,3000,3000,1000]);
  assert.deepEqual(r.schedule.map(p => p.paymentDate),['2024-01-31','2024-02-29','2024-03-31','2024-04-30']);
  assert.equal(n(r.totalInterest),0); assert.equal(n(r.unusedBudget),2000);
  for (const p of r.schedule) { assert.equal(n(p.totalPaid)+n(p.unusedBudget),3000); for (const x of p.accounts) assert.equal(n(x.openingObligation)+n(x.interestAccrued)-n(x.totalPaid),n(x.closingObligation)); }
});
test('S2: monthly interest precedes payment', () => {
  const r = calculatePayoff({ ...input([a('A',100000,12000)],10000), maxHorizonMonths: 1 });
  assert.equal(r.status,'horizonReached'); assert.equal(n(r.schedule[0].totalInterest),1000); assert.equal(n(r.remainingDebt),91000); assert.equal(n(r.partialPayments),10000);
});
test('S3: minimums and same-period rollover over two periods', () => {
  const r = run([a('A',4000,0,1000),a('B',10000,0,2000)],10000);
  assert.equal(r.status,'paidOff');
  assert.deepEqual(r.schedule.map(p => p.accounts.map(x => n(x.totalPaid))),[[4000,6000],[0,4000]]);
  assert.deepEqual(r.schedule.map(p => n(p.unusedBudget)),[0,6000]); assert.equal(n(r.totalPayments),14000);
  assert.equal(r.accounts[0].payoffMonth,1); assert.equal(r.accounts[1].payoffDate,'2024-02-29');
});
test('S4: priorities and deterministic ties', () => {
  const rows = [{accountId:'B',openingObligation:m(10000),aprThousandths:10000},{accountId:'C',openingObligation:m(20000),aprThousandths:20000},{accountId:'A',openingObligation:m(10000),aprThousandths:10000}];
  assert.deepEqual(rankAcceleratedAccounts(rows,'snowball').map(x=>x.accountId),['A','B','C']);
  assert.deepEqual(rankAcceleratedAccounts(rows,'avalanche').map(x=>x.accountId),['C','A','B']);
  const ties = [{accountId:'Z',openingObligation:m(100),aprThousandths:20000},{accountId:'A',openingObligation:m(100),aprThousandths:10000},{accountId:'B',openingObligation:m(50),aprThousandths:20000}];
  assert.deepEqual(rankAcceleratedAccounts(ties,'snowball').map(x=>x.accountId),['B','Z','A']);
  assert.deepEqual(rankAcceleratedAccounts(ties,'avalanche').map(x=>x.accountId),['B','Z','A']);
});
test('S5: shortfall, nonamortization, horizon and zero payment', () => {
  let r = run([a('A',10000,0,6000),a('B',10000,0,5000)],10000);
  assert.equal(r.status,'paymentShortfall'); assert.equal(n(r.requiredMinimums),11000); assert.equal(n(r.shortfallAmount),1000); assert.equal(r.schedule.length,0); assert.deepEqual(r.accountRequirements.map(x=>n(x.requiredMinimum)),[6000,5000]);
  r = run([a('A',100000,12000)],500); assert.equal(r.status,'notAmortizingUnderAssumptions'); assert.equal(n(r.remainingDebt),100500);
  r = calculatePayoff({...input([a('A',10000)],100),maxHorizonMonths:3}); assert.equal(r.status,'horizonReached'); assert.equal(n(r.remainingDebt),9700); assert.equal(n(r.partialPayments),300);
  r = run([a('A',10000)],0); assert.equal(r.status,'notAmortizingUnderAssumptions'); assert.equal(n(r.partialPayments),0);
  r = run([a('A',10000,0,1000)],0); assert.equal(r.status,'paymentShortfall'); assert.equal(n(r.shortfallAmount),1000);
});
test('S6: credits, inventory availability and input validation', () => {
  let r = run([a('zero',0),a('credit',-2000)],undefined,5000); assert.equal(r.status,'paidOff'); assert.equal(r.monthsToPayoff,0); assert.equal(n(r.unusedBudget),5000); assert.equal(n(r.accounts[1].balance),-2000);
  r = calculatePayoff({...input([a('credit',-2000),a('debt',10000)],5000),maxHorizonMonths:1}); assert.equal(r.status,'horizonReached'); assert.equal(n(r.remainingDebt),5000); assert.equal(n(r.schedule[0].accounts[0].totalPaid),0);
  for (const accounts of [{status:'loading'},{status:'unavailable',reason:'offline'},{status:'known-empty',context:{...context,coverage:{status:'unknown'}}}]) assert.equal(calculatePayoff({...input([],0),accounts}).status,'insufficientData');
  assert.equal(calculatePayoff({...input([],0),accounts:{status:'known-empty',context}}).status,'paidOff');
  assert.equal(run([a('x',100,null)],100).status,'insufficientData'); assert.equal(run([a('x',100,0,null)],100).status,'insufficientData');
  for (const invalid of [{...input([a('x',100)],100),extraMonthlyPayment:m(-1)},{...input([a('x',100)],100),extraMonthlyPayment:m(1,'CAD')},{...input([a('x',100)],100),assumptions:{firstPaymentDate:'2024-02-30',requestedDay:30,householdTimeZone:'UTC'}},{...input([a('x',100)],100),assumptions:{firstPaymentDate:'2024-01-30',requestedDay:31,householdTimeZone:'UTC'}},{...input([a('x',100)],100),assumptions:{firstPaymentDate:'2024-01-31',requestedDay:31,householdTimeZone:'Bad/Zone'}},{...input([a('x',100),a('x',100)],100)},{...input([a('x',100,100001)],100)},{...input([a('x',100,0,-1)],100)},{...input([a('x',100)],100),strategy:'other'},{...input([a('x',100)],100),maxHorizonMonths:0}]) { const result = calculatePayoff(invalid); assert.equal(result.status,'invalidInput'); assert.ok(result.reason); }
});
test('S7: half-cent interest boundary', () => {
  const r = run([a('A',150,12000)],100); assert.equal(r.status,'paidOff'); assert.deepEqual(r.schedule.map(p=>n(p.totalInterest)),[2,1]); assert.deepEqual(r.schedule.map(p=>n(p.totalPaid)),[100,53]); assert.equal(n(r.totalInterest),3); assert.equal(n(r.totalPayments),153); assert.equal(n(r.unusedBudget),47);
});
test('minimum-only and excluded accounts; default fixed commitment', () => {
  const r = run([a('min',10000,0,1000,'minimum-only'),a('fast',2000,0,500),a('excluded',50000,0,1000,'excluded')],undefined,2500);
  assert.equal(r.status,'paidOff'); assert.equal(n(r.monthlyCommitment),4000); assert.equal(n(r.schedule[0].accounts[0].totalPaid),1000); assert.equal(n(r.schedule[0].accounts[1].totalPaid),2000); assert.equal(n(r.schedule[0].unusedBudget),1000); assert.equal(n(r.accounts[2].balance),50000); assert.equal(n(r.accounts[2].remainingObligation),0);
});
