import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRecurringBillDate,
  createConfirmedRecurringBillTransaction,
} from '../src/finance/recurring-bills.ts';
import { parseMoney } from '../src/finance/money.ts';
import { parseDateOnly } from '../src/finance/calendar.ts';

test('Recurring bill due dates clamp to month bounds', () => {
  assert.equal(resolveRecurringBillDate('2026-11', 15), '2026-11-15');
  assert.equal(resolveRecurringBillDate('2026-11', 31), '2026-11-30');
  assert.equal(resolveRecurringBillDate('2024-02', 31), '2024-02-29');
  assert.equal(resolveRecurringBillDate('2026-02', 31), '2026-02-28');
  assert.throws(() => resolveRecurringBillDate('invalid', 15), /Invalid month format/);
  assert.throws(() => resolveRecurringBillDate('2026-11', 0), /Invalid due day/);
  assert.throws(() => resolveRecurringBillDate('2026-11', 32), /Invalid due day/);
});

test('recurring bills create no transaction until a payment is explicitly confirmed', () => {
  const bill = {
    id: 'bill-electric', name: 'Electric Company', category: 'utilities',
    amount: parseMoney('120.00', 'USD'), dueDay: 5, paymentMethod: 'debit',
    autoPost: true, active: true, createdAt: '2026-11-01T00:00:00Z',
  };
  assert.equal(typeof createConfirmedRecurringBillTransaction, 'function');
  const tx = createConfirmedRecurringBillTransaction({
    bill,
    dueCycle: parseDateOnly('2026-12-05'),
    actualDate: parseDateOnly('2026-11-20'),
    now: new Date('2026-11-20T12:00:00Z'),
  });
  assert.equal(tx.id, 'bill:bill-electric:2026-12-05');
  assert.equal(tx.accountId, null);
  assert.equal(tx.category, 'debit_bill');
  assert.equal(tx.date, '2026-11-20');
  assert.equal(tx.appliesToDate, '2026-12-05');
  assert.equal(tx.source, 'recurring_bill');
  const retried = createConfirmedRecurringBillTransaction({
    bill,
    dueCycle: parseDateOnly('2026-12-05'),
    actualDate: parseDateOnly('2026-11-20'),
    now: new Date('2026-11-21T12:00:00Z'),
  });
  assert.equal(retried.id, tx.id, 'a repeated confirmation for the same cycle has the same idempotency key');
});

test('confirmed credit recurring bill increases only its selected card account', () => {
  const bill = {
    id: 'bill-netflix', name: 'Netflix Subscription', category: 'subscription',
    amount: parseMoney('19.99', 'USD'), dueDay: 3, paymentMethod: 'credit',
    creditAccountId: 'chase-sapphire', autoPost: false, active: true,
    createdAt: '2026-11-01T00:00:00Z',
  };
  const tx = createConfirmedRecurringBillTransaction({
    bill, dueCycle: parseDateOnly('2026-12-03'), actualDate: parseDateOnly('2026-11-05'),
  });
  assert.equal(tx.id, 'bill:bill-netflix:2026-12-03');
  assert.equal(tx.category, 'subscription');
  assert.equal(tx.accountId, 'chase-sapphire');
  assert.equal(tx.amount.minorUnits, 1999);
  assert.equal(tx.date, '2026-11-05');
  assert.equal(tx.appliesToDate, '2026-12-03');
});

test('confirmed recurring bills retain separate posting and cycle dates across currencies (JPY, KWD, CLF)', () => {
  for (const item of [
    { code: 'JPY', amount: '2500', minorUnits: 2500 },
    { code: 'KWD', amount: '12.345', minorUnits: 12345 },
    { code: 'CLF', amount: '1.2345', minorUnits: 12345 },
  ]) {
    const bill = {
      id: `bill-${item.code.toLowerCase()}`,
      name: `Multi-Currency Bill ${item.code}`,
      category: 'utilities',
      amount: parseMoney(item.amount, item.code),
      dueDay: 15,
      paymentMethod: 'credit',
      creditAccountId: `card-${item.code.toLowerCase()}`,
      autoPost: false,
      active: true,
      createdAt: '2026-11-01T00:00:00Z',
    };
    const tx = createConfirmedRecurringBillTransaction({
      bill,
      dueCycle: parseDateOnly('2026-12-15'),
      actualDate: parseDateOnly('2026-11-28'), // paid early
    });
    assert.equal(tx.id, `bill:bill-${item.code.toLowerCase()}:2026-12-15`);
    assert.equal(tx.date, '2026-11-28');
    assert.equal(tx.appliesToDate, '2026-12-15');
    assert.equal(tx.amount.minorUnits, item.minorUnits);
    assert.equal(tx.amount.currency, item.code);
    assert.equal(tx.accountId, `card-${item.code.toLowerCase()}`);
  }
});
