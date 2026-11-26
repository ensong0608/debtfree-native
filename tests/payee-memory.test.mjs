import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteCsvPayeeRule,
  deleteCsvPreset,
  listRecentPayees,
  lookupPayeeMemory,
  matchCsvPayeeRule,
  recordPayeeMemory,
  upsertCsvPayeeRule,
  upsertCsvPreset,
} from '../src/finance/payee-memory.ts';
import { parseBankCsv, resolveCsvRowCategory } from '../src/finance/csv.ts';
import { makeMoney } from '../src/finance/money.ts';

test('Payee memory remembers non-generic payees, skips generic labels, and ranks recent payees', () => {
  let payees = {};
  payees = recordPayeeMemory(payees, {
    payee: 'Payment',
    category: 'payment',
    accountId: 'card-1',
    updatedAt: '2026-11-01T10:00:00Z',
  });
  assert.equal(Object.keys(payees).length, 0);

  payees = recordPayeeMemory(payees, {
    payee: "Trader  Joe's",
    category: 'debit_spending',
    accountId: null,
    updatedAt: '2026-11-02T10:00:00Z',
  });
  const hit = lookupPayeeMemory(payees, "trader joe's");
  assert.ok(hit);
  assert.equal(hit.category, 'debit_spending');
  assert.equal(hit.payee, "Trader Joe's");

  const txs = [
    {
      id: 'tx-1',
      accountId: null,
      date: '2026-11-05',
      amount: makeMoney('USD', 4250),
      category: 'debit_spending',
      payee: 'Corner Market',
      source: 'manual',
      reconciled: false,
      createdAt: '2026-11-05T12:00:00Z',
      deletedAt: null,
    },
    {
      id: 'tx-2',
      accountId: null,
      date: '2026-11-06',
      amount: makeMoney('USD', 1500),
      category: 'debit_spending',
      payee: 'Cash / Debit',
      source: 'manual',
      reconciled: false,
      createdAt: '2026-11-06T12:00:00Z',
      deletedAt: null,
    },
  ];
  const recent = listRecentPayees(payees, txs, 5);
  assert.deepEqual(recent.map(r => r.payee), ["Trader Joe's", 'Corner Market']);
});

test('CSV import presets and payee rules support custom headers and auto-categorization', () => {
  let presets = upsertCsvPreset([], {
    name: 'Chase Checking',
    targetAccountId: '',
    mapping: { dateColumn: 'Posted Date', payeeColumn: 'Merchant Name', amountColumn: 'Transaction Amount', chargesPositive: false },
    updatedAt: '2026-11-01T00:00:00Z',
  });
  assert.equal(presets.length, 1);

  let rules = upsertCsvPayeeRule([], {
    pattern: 'Netflix',
    category: 'subscription',
    accountId: 'card-1',
    updatedAt: '2026-11-01T00:00:00Z',
  });
  rules = upsertCsvPayeeRule(rules, {
    pattern: 'Netflix UHD',
    category: 'utilities',
    accountId: 'card-1',
    updatedAt: '2026-11-01T00:00:00Z',
  });
  assert.equal(matchCsvPayeeRule(rules, 'NETFLIX UHD STREAMING')?.category, 'utilities');

  const csv = 'Posted Date,Merchant Name,Transaction Amount\n11/10/2026,Netflix UHD,-19.99\n11/11/2026,Local Bakery,-8.50';
  const parsed = parseBankCsv(csv, [], 'USD', { mapping: presets[0].mapping, rules });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].suggestedCategory, 'utilities');
  assert.equal(parsed[1].suggestedCategory, undefined);

  // Sign-preservation: a purchase/utilities rule never flips a credit/refund/payment row into a charge.
  assert.equal(resolveCsvRowCategory({
    amount: makeMoney('USD', -1999),
    hasDebtAccount: true,
    chargesPositive: false,
    suggestedCategory: 'utilities',
  }), 'utilities');
  assert.equal(resolveCsvRowCategory({
    amount: makeMoney('USD', 1999),
    hasDebtAccount: true,
    chargesPositive: false,
    suggestedCategory: 'utilities',
  }), 'payment');
  assert.equal(resolveCsvRowCategory({
    amount: makeMoney('USD', 1999),
    hasDebtAccount: true,
    chargesPositive: false,
    suggestedCategory: 'refund',
  }), 'refund');

  presets = deleteCsvPreset(presets, presets[0].id);
  rules = deleteCsvPayeeRule(rules, rules[0].id);
  assert.equal(presets.length, 0);
  assert.equal(rules.length, 1);
});
