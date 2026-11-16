// @ts-ignore Node built-in types omitted when @types/node is absent from Expo tsconfig.
import assert from 'node:assert/strict';
// @ts-ignore Node built-in types omitted when @types/node is absent from Expo tsconfig.
import { createHash } from 'node:crypto';
// @ts-ignore Node built-in types omitted when @types/node is absent from Expo tsconfig.
import * as fs from 'node:fs';
// @ts-ignore Node built-in types omitted when @types/node is absent from Expo tsconfig.
import * as path from 'node:path';
// @ts-ignore Node built-in types omitted when @types/node is absent from Expo tsconfig.
import { pathToFileURL } from 'node:url';

import {
  nativeBackupLifecycleWarnings,
  validateNativeBackup,
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
} from '../src/finance/backup.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { calculateReconciledBalance } from '../src/finance/ledger.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { makeMoney } from '../src/finance/money.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { processRecurringBills } from '../src/finance/recurring-bills.ts';
import {
  decodeReconciliationAnchorRow,
  decodeRecurringBillRow,
  decodeTransactionRow,
  encodeReconciliationAnchorRow,
  encodeRecurringBillRow,
  encodeTransactionRow,
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
} from '../src/finance/storage-domain.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { validateStoredAmounts } from '../src/debt-storage-domain.ts';
// @ts-ignore TS5097: no-emit typecheck without allowImportingTsExtensions.
import { convertDashboardBackup } from './convert-dashboard-backup.ts';

declare const Buffer: any;
declare const process: any;

function runSyntheticTests(): void {
  const syntheticSource = {
    format: 'debtfree-dashboard-backup',
    version: 6,
    exportedAt: '2026-05-15T12:00:00.000Z',
    payload: {
      strategy: 'avalanche',
      extra: 500,
      accounts: [
        {
          id: 'acc-1',
          name: 'Card Alpha',
          balance: 1000,
          baselineBalance: 1200,
          apr: 19.99,
          minimum: 35,
          dueDate: '2026-05-20',
          creditLimit: 5000,
          createdAt: '2026-04-01T00:00:00.000Z',
          reconciliation: {
            adjustmentId: 'adj-neg',
            date: '2026-05-10',
            balance: 850.25,
            offset: 0,
            coveredTransactionIds: ['tx-zero'],
            createdAt: '2026-05-10T10:00:00.000Z',
          },
        },
        {
          id: 'acc-archived',
          name: 'Card Beta',
          balance: 0,
          baselineBalance: 200,
          apr: 0,
          minimum: 0,
          archivedAt: '2026-05-01T00:00:00.000Z',
          archiveHistory: [
            { id: 'arch-1', createdAt: '2026-05-01T00:00:00.000Z', reason: 'paid off' },
          ],
        },
      ],
      transactions: [
        {
          id: 'tx-zero',
          accountId: 'acc-1',
          type: 'fee',
          category: 'Interest',
          amount: 0,
          date: '2026-05-05',
          payeeName: 'Bank',
          createdAt: '2026-05-05T00:00:00.000Z',
          deletedAt: '2026-05-06T00:00:00.000Z',
        },
        {
          id: 'tx-auto-bill',
          accountId: 'acc-1',
          type: 'charge',
          category: 'Subscription',
          amount: 15,
          date: '2026-05-02',
          payeeName: 'Cloud Drive',
          automaticRecurringCharge: true,
          plannedSourceId: 'bill-src-1',
          createdAt: '2026-05-02T00:00:00.000Z',
          deletedAt: null,
        },
        {
          id: 'tx-post-anchor-pay',
          accountId: 'acc-1',
          type: 'payment',
          category: 'Payment',
          amount: 100,
          date: '2026-05-12',
          payeeName: 'Card Alpha',
          createdAt: '2026-05-12T00:00:00.000Z',
          deletedAt: null,
        },
        {
          id: 'tx-payoff-beta',
          accountId: 'acc-archived',
          type: 'payment',
          category: 'Payment',
          amount: 200,
          date: '2026-05-01',
          payeeName: 'Card Beta',
          createdAt: '2026-05-01T00:00:00.000Z',
          deletedAt: null,
        },
      ],
      balanceAdjustments: [
        {
          id: 'adj-neg',
          accountId: 'acc-1',
          date: '2026-05-10',
          balanceBefore: 1015,
          balanceAfter: 850.25,
          difference: -164.75,
          title: 'Statement reconcile',
          reconciliationAnchor: {
            adjustmentId: 'adj-neg',
            accountId: 'acc-1',
            date: '2026-05-10',
            balance: 850.25,
            offset: 0,
            coveredTransactionIds: ['tx-zero'],
            createdAt: '2026-05-10T10:00:00.000Z',
          },
          createdAt: '2026-05-10T10:00:00.000Z',
          deletedAt: null,
        },
        {
          id: 'adj-del',
          accountId: 'acc-1',
          date: '2026-05-03',
          balanceBefore: 1000,
          balanceAfter: 900,
          difference: -100,
          createdAt: '2026-05-03T10:00:00.000Z',
          deletedAt: '2026-05-04T10:00:00.000Z',
        },
      ],
      monthlyBudgets: {
        '2026-05': [
          {
            id: 'inc-1',
            kind: 'income',
            name: 'Salary',
            amount: 4000,
            recurring: true,
          },
          {
            id: 'bill-src-1',
            recurringSourceId: 'bill-src-1',
            kind: 'expense',
            name: 'Cloud Drive',
            category: 'Subscriptions',
            amount: 15,
            dueDay: 2,
            paymentMethod: 'credit',
            creditAccountId: 'acc-1',
            recurring: true,
            autoPay: true,
          },
        ],
      },
      payees: [],
      snapshots: [],
      monthlyPlan: {
        payoffPlanStrategy: 'snowball',
        payoffExtraPayment: 250,
        loanTrackers: [],
        months: {},
        duePaymentAssociations: [],
        disabledRecurringSources: [],
      },
    },
  };

  const raw = JSON.stringify(syntheticSource);
  const res1 = convertDashboardBackup(raw, {
    userId: '11111111-1111-4111-8111-111111111111',
    householdId: 'hh-synthetic-1',
  });
  const res2 = convertDashboardBackup(raw, {
    userId: '11111111-1111-4111-8111-111111111111',
    householdId: 'hh-synthetic-1',
  });

  // 1. Negative-difference balance adjustment must map ONLY to reconciliation_anchors (never synthetic payment TX)
  assert.equal(res1.nativeBackup.reconciliationAnchors.length, 1);
  assert.equal(res1.nativeBackup.reconciliationAnchors[0].verifiedBalance.minorUnits, 85025);
  assert.equal(res1.nativeBackup.transactions.filter((t) => t.category === 'payment').length, 2);
  const cardAlphaDebtId = res1.nativeBackup.onboardingData.debts.find((d) => d.name === 'Card Alpha')!.id;
  assert.equal(
    res1.nativeBackup.transactions.filter((t) => t.accountId === cardAlphaDebtId && t.category === 'payment').length,
    1,
  );

  // 2. Zero-amount TX must be excluded from native transactions and preserved in archive
  assert.equal(res1.nativeBackup.transactions.some((t) => t.id === 'tx-zero'), false);
  const zeroArch = res1.importRecords.find((r) => r.domain === 'transaction_archive' && r.id === 'tx-zero');
  assert.equal(zeroArch?.disposition, 'excluded_from_active_ledger');

  // 3. Card Alpha balance = 850.25 - 100.00 = 750.25
  const cardAlpha = res1.nativeBackup.onboardingData.debts.find((d) => d.name === 'Card Alpha');
  assert.equal(cardAlpha?.balance, 750.25);

  // 4. Auto-post bill deduplication leaves 0 duplicate transactions
  assert.equal(res1.autoPostSimulation.newTransactionCount, 0);

  // 5. Archived paid-off card UUID present in household settings
  assert.equal((res1.sharedHouseholdSettings.archivedPaidOffDebtIds as string[]).length, 1);

  // 6. Full deterministic idempotency
  assert.equal(JSON.stringify(res1.nativeBackup), JSON.stringify(res2.nativeBackup));
  assert.equal(JSON.stringify(res1.importRecords), JSON.stringify(res2.importRecords));

  // 7. Native validator + row codec roundtrip
  validateNativeBackup(res1.nativeBackup, {
    userId: res1.nativeBackup.userId,
    householdId: res1.nativeBackup.householdId,
    role: 'owner',
  });
  validateStoredAmounts(res1.nativeBackup.onboardingData);
  assert.deepEqual(nativeBackupLifecycleWarnings(res1.nativeBackup), []);
  for (const tx of res1.nativeBackup.transactions) {
    const encoded = encodeTransactionRow(tx, res1.nativeBackup.userId, res1.nativeBackup.householdId);
    const decoded = decodeTransactionRow(encoded, res1.nativeBackup.currency);
    assert.equal(decoded.id, tx.id);
    assert.equal(decoded.amount.minorUnits, tx.amount.minorUnits);
  }
  for (const bill of res1.nativeBackup.recurringBills) {
    const encoded = encodeRecurringBillRow(bill, res1.nativeBackup.userId, res1.nativeBackup.householdId);
    const decoded = decodeRecurringBillRow(encoded, res1.nativeBackup.currency);
    assert.equal(decoded.id, bill.id);
    assert.equal(decoded.amount.minorUnits, bill.amount.minorUnits);
  }
  for (const anchor of res1.nativeBackup.reconciliationAnchors) {
    const encoded = encodeReconciliationAnchorRow(anchor, res1.nativeBackup.userId, res1.nativeBackup.householdId);
    const decoded = decodeReconciliationAnchorRow(encoded, res1.nativeBackup.currency);
    assert.equal(decoded.id, anchor.id);
    assert.equal(decoded.verifiedBalance.minorUnits, anchor.verifiedBalance.minorUnits);
  }
}

function verifyPrivatePackage(privateDir: string, sourceInputPath?: string, decisionsPath?: string): Record<string, unknown> {
  const manifestPath = path.join(privateDir, 'conversion-manifest.json');
  const backupPath = path.join(privateDir, 'native-backup.json');
  const bundlePath = path.join(privateDir, 'migration-bundle.json');
  const applyPath = path.join(privateDir, '03_apply_atomic.sql');
  const verifyPath = path.join(privateDir, '04_verify.sql');
  const rollbackPath = path.join(privateDir, '05_rollback.sql');
  const stageCreatePath = path.join(privateDir, '01_stage_create.sql');
  const checkPath = path.join(privateDir, '00_schema_migration_check.sql');

  for (const p of [manifestPath, backupPath, bundlePath, applyPath, verifyPath, rollbackPath, stageCreatePath, checkPath]) {
    assert.ok(fs.existsSync(p), `Missing required package file: ${p}`);
  }

  const nativeBackup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const bundleRaw = fs.readFileSync(bundlePath, 'utf8');
  const bundle = JSON.parse(bundleRaw);

  // Native backup validation
  validateNativeBackup(nativeBackup, {
    userId: nativeBackup.userId,
    householdId: nativeBackup.householdId,
    role: 'owner',
  });
  validateStoredAmounts(nativeBackup.onboardingData);
  assert.deepEqual(nativeBackupLifecycleWarnings(nativeBackup), []);

  // Codec round-trip on every row
  for (const tx of nativeBackup.transactions) {
    const row = encodeTransactionRow(tx, nativeBackup.userId, nativeBackup.householdId);
    const decoded = decodeTransactionRow(row, nativeBackup.currency);
    assert.equal(decoded.amount.minorUnits, tx.amount.minorUnits);
    assert.ok(tx.amount.minorUnits > 0, `Non-positive transaction found in active ledger: ${tx.id}`);
  }
  for (const bill of nativeBackup.recurringBills) {
    const row = encodeRecurringBillRow(bill, nativeBackup.userId, nativeBackup.householdId);
    const decoded = decodeRecurringBillRow(row, nativeBackup.currency);
    assert.equal(decoded.amount.minorUnits, bill.amount.minorUnits);
  }
  for (const anchor of nativeBackup.reconciliationAnchors) {
    const row = encodeReconciliationAnchorRow(anchor, nativeBackup.userId, nativeBackup.householdId);
    const decoded = decodeReconciliationAnchorRow(row, nativeBackup.currency);
    assert.equal(decoded.verifiedBalance.minorUnits, anchor.verifiedBalance.minorUnits);
  }

  // Exact cent balance parity on every debt
  for (const debt of nativeBackup.onboardingData.debts) {
    const accAnchors = nativeBackup.reconciliationAnchors
      .filter((a: any) => a.accountId === debt.id)
      .sort((a: any, b: any) => b.asOfDate.localeCompare(a.asOfDate) || b.createdAt.localeCompare(a.createdAt));
    const latestAnchor = accAnchors[0] ?? null;
    const opening = makeMoney(nativeBackup.currency, Math.round((debt.originalBalance ?? debt.balance) * 100));
    const res = calculateReconciledBalance({
      openingBalance: opening,
      anchor: latestAnchor,
      transactions: nativeBackup.transactions,
      accountId: debt.id,
      debtCategory: debt.category,
    });
    assert.equal(
      res.currentBalance.minorUnits,
      Math.round(debt.balance * 100),
      `Balance parity mismatch for ${debt.name}`,
    );
  }

  // Auto-post simulation check
  const sim = processRecurringBills({
    bills: nativeBackup.recurringBills,
    existingTransactions: nativeBackup.transactions,
    currentInstant: new Date(nativeBackup.exportedAt),
    householdTimeZone: 'America/Los_Angeles',
  });
  assert.equal(sim.newTransactions.length, 0);

  // Unique keys across all import records
  const importRecordKeys = new Set<string>();
  for (const rec of bundle.importRecords) {
    const k = `${rec.domain}::${rec.id}`;
    assert.ok(!importRecordKeys.has(k), `Duplicate import record key: ${k}`);
    importRecordKeys.add(k);
  }

  // Chunk integrity + SHA-256 verification
  const chunkFiles = (fs.readdirSync(privateDir) as string[])
    .filter((f: string) => /^02_stage_chunk_\d+\.sql$/.test(f))
    .sort();
  assert.ok(chunkFiles.length > 0, 'No stage chunk files found');
  let reassembledB64 = '';
  for (let i = 0; i < chunkFiles.length; i++) {
    const expectedName = `02_stage_chunk_${String(i + 1).padStart(String(chunkFiles.length).length >= 2 ? String(chunkFiles.length).length : 2, '0')}.sql`;
    assert.equal(chunkFiles[i], expectedName, `Non-sequential chunk file ${chunkFiles[i]}`);
    const content = fs.readFileSync(path.join(privateDir, chunkFiles[i]), 'utf8');
    assert.ok(Buffer.byteLength(content, 'utf8') < 25000, `Chunk too large: ${chunkFiles[i]}`);
    const match = /VALUES \('[^']+', \d+, '([^']+)', '([0-9a-f]{64})'\)/.exec(content);
    if (!match) {
      throw new Error(`Unexpected chunk SQL syntax in ${chunkFiles[i]}`);
    }
    assert.equal(Number(content.match(/VALUES \('[^']+', (\d+),/)?.[1]), i + 1);
    reassembledB64 += match[1];
  }

  const reassembledJson = Buffer.from(reassembledB64, 'base64').toString('utf8');
  assert.equal(reassembledJson, bundleRaw, 'Reassembled base64 payload does not match migration-bundle.json');
  const bundleSha = createHash('sha256').update(bundleRaw, 'utf8').digest('hex');
  const applySql = fs.readFileSync(applyPath, 'utf8');
  assert.ok(applySql.includes(bundleSha), '03_apply_atomic.sql missing expected bundle SHA-256');
  assert.ok(!applySql.includes('extensions.digest'), '03_apply_atomic.sql still calls extensions.digest');
  assert.ok(!applySql.includes('\nPERFORM pg_catalog.set_config'), 'Top-level PERFORM invalid outside PL/pgSQL');

  const rollbackSql = fs.readFileSync(rollbackPath, 'utf8');
  assert.ok(!rollbackSql.includes('\nPERFORM pg_catalog.set_config'), '05_rollback.sql has top-level PERFORM');
  assert.ok(rollbackSql.includes('SELECT pg_catalog.set_config(\'debtfree.restore_importing\', \'on\', true)'), '05_rollback.sql missing restore flag');

  if (sourceInputPath) {
    const rawSource = fs.readFileSync(sourceInputPath, 'utf8');
    const baselinePath = path.join(privateDir, 'destination-backup.json');
    const baselineDest = fs.existsSync(baselinePath)
      ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
      : null;
    const rerun = convertDashboardBackup(rawSource, {
      userId: nativeBackup.userId,
      householdId: nativeBackup.householdId,
      baselineDest,
      decisions: decisionsPath ? JSON.parse(fs.readFileSync(decisionsPath, 'utf8')) : undefined,
    });
    assert.equal(createHash('sha256').update(rawSource, 'utf8').digest('hex'), rerun.sourceSha256);
    assert.equal(rerun.sourceSha256, manifest.source.sha256);
    assert.equal(rerun.ownerQuestions.length, 0);
    assert.equal(rerun.importRecords.filter((r) => r.disposition === 'pending_owner_clarification').length, 0);
    const decisions = decisionsPath ? JSON.parse(fs.readFileSync(decisionsPath, 'utf8')) : {};
    for (const pair of decisions.duplicateAdjustmentTransactionPairs ?? []) {
      const record = rerun.importRecords.find((r) => r.domain === 'balance_adjustment' && r.source_id === pair.adjustmentId);
      assert.equal((record?.source_record as any)?.nativeAdjustmentTxId, (rerun.identityMap.transactions as Record<string, string>)[pair.transactionId]);
    }
    for (const pair of decisions.duplicateSettlements ?? []) {
      const record = rerun.importRecords.find((r) => r.domain === 'monthly_plan_settlement' && r.source_id === pair.settlementId);
      const original = rerun.importRecords.find((r) => r.domain === 'monthly_plan_settlement' && r.source_id === pair.activeSettlementId);
      assert.ok(record?.native_record_id && record.native_record_id === original?.native_record_id);
    }
    for (const mapping of [...(decisions.historicalLoanSettlementMappings ?? []), ...(decisions.dedupedLoanSettlements ?? [])]) {
      const record = rerun.importRecords.find((r) => r.domain === 'monthly_plan_settlement' && r.source_id === mapping.settlementId);
      const tx = rerun.nativeBackup.transactions.find((t) => t.id === record?.native_record_id);
      assert.equal(tx?.category, 'payment');
      assert.equal(tx?.accountId, (rerun.identityMap.accounts as Record<string, string>)[mapping.loanId]);
    }
    assert.equal(JSON.stringify(rerun.nativeBackup), JSON.stringify(nativeBackup));
    assert.equal(rerun.importRecords.length, bundle.importRecords.length);
  }

  return {
    chunkCount: chunkFiles.length,
    bundleSha256: bundleSha,
    debtsVerified: nativeBackup.onboardingData.debts.length,
    billsVerified: nativeBackup.recurringBills.length,
    transactionsVerified: nativeBackup.transactions.length,
    anchorsVerified: nativeBackup.reconciliationAnchors.length,
    importRecordsVerified: bundle.importRecords.length,
    manifestKey: manifest.migrationKey,
  };
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = val;
    i++;
  }
  return args;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runSyntheticTests();
  const args = parseArgs(process.argv.slice(2));
  const privateSummary = args['private-dir']
    ? verifyPrivatePackage(args['private-dir'], args['source-input'], args['decisions'] ?? path.join(args['private-dir'], 'decisions.json'))
    : null;
  console.log(
    JSON.stringify(
      {
        status: 'ok',
        syntheticTests: 'passed',
        privateVerification: privateSummary,
      },
      null,
      2,
    ),
  );
}
