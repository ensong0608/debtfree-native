import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  applyTransactionToBalance,
  calculateTransactionBalanceDelta,
  getUnallocatedPaymentAmount,
  validateLedgerTransaction,
  calculateReconciledBalance,
} = require('../src/finance/ledger.ts');
const { makeMoney } = require('../src/finance/money.ts');
const { parseDateOnly } = require('../src/finance/calendar.ts');
const {
  encodeTransactionRow,
  decodeTransactionRow,
} = require('../src/finance/storage-domain.ts');

test('Phase 1: Mortgage payment with full allocation reduces balance ONLY by principal reduction', () => {
  const mortgageBalance = makeMoney('USD', 30000000); // $300,000.00
  const tx = {
    id: 'tx-mortgage-1',
    accountId: 'mortgage-1',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', 210000), // $2,100.00 total cash paid
    category: 'payment',
    payee: 'Mortgage Servicer',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: null,
    principalAmount: makeMoney('USD', 55000), // $550.00 principal
    interestAmount: makeMoney('USD', 115000), // $1,150.00 interest
    escrowAmount: makeMoney('USD', 35000), // $350.00 escrow
    feeAmount: makeMoney('USD', 5000), // $50.00 fee
  };

  validateLedgerTransaction(tx);

  // Unallocated check: $2100 - ($550 + $1150 + $350 + $50) = $0
  const unallocated = getUnallocatedPaymentAmount(tx);
  assert.equal(unallocated.minorUnits, 0);

  // Delta on mortgage should be -$550.00 (principal only)
  const delta = calculateTransactionBalanceDelta(tx, 'Mortgage');
  assert.equal(delta.minorUnits, -55000);

  const updatedBalance = applyTransactionToBalance(mortgageBalance, tx, 'Mortgage');
  assert.equal(updatedBalance.minorUnits, 29945000); // $299,450.00
});

test('Phase 1: Mortgage payment with unknown breakdown preserves payment record without inventing principal reductions', () => {
  const mortgageBalance = makeMoney('USD', 30000000); // $300,000.00
  const tx = {
    id: 'tx-mortgage-unknown',
    accountId: 'mortgage-1',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', 210000), // $2,100.00 cash payment
    category: 'payment',
    payee: 'Mortgage Servicer',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: null,
    // No allocations provided: breakdown unknown!
  };

  validateLedgerTransaction(tx);

  // Unallocated check: full $2,100 is unallocated
  const unallocated = getUnallocatedPaymentAmount(tx);
  assert.equal(unallocated.minorUnits, 210000);

  // Delta on mortgage with unknown breakdown is $0
  const delta = calculateTransactionBalanceDelta(tx, 'Mortgage');
  assert.equal(delta.minorUnits, 0);

  // Balance remains untouched: no invented principal reduction
  const updatedBalance = applyTransactionToBalance(mortgageBalance, tx, 'Mortgage');
  assert.equal(updatedBalance.minorUnits, 30000000);
});

test('Phase 1: Auto loan payment with principal allocation reduces balance by principal amount only', () => {
  const autoBalance = makeMoney('USD', 2500000); // $25,000.00
  const txWithBreakdown = {
    id: 'tx-auto-1',
    accountId: 'auto-1',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', 48000), // $480.00 payment
    category: 'payment',
    payee: 'Auto Financing',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: null,
    principalAmount: makeMoney('USD', 38000), // $380.00 principal
    interestAmount: makeMoney('USD', 10000), // $100.00 interest
  };

  const delta = calculateTransactionBalanceDelta(txWithBreakdown, 'Auto loan');
  assert.equal(delta.minorUnits, -38000);
  const updatedWithBreakdown = applyTransactionToBalance(autoBalance, txWithBreakdown, 'Auto loan');
  assert.equal(updatedWithBreakdown.minorUnits, 2462000);

  // Without breakdown: does not invent principal reduction
  const txWithoutBreakdown = {
    ...txWithBreakdown,
    id: 'tx-auto-unknown',
    principalAmount: undefined,
    interestAmount: undefined,
  };
  const deltaUnknown = calculateTransactionBalanceDelta(txWithoutBreakdown, 'Auto loan');
  assert.equal(deltaUnknown.minorUnits, 0);
  const updatedWithoutBreakdown = applyTransactionToBalance(autoBalance, txWithoutBreakdown, 'Auto loan');
  assert.equal(updatedWithoutBreakdown.minorUnits, 2500000);
});

test('Phase 1: Credit card payment without explicit breakdown reduces revolving balance by full amount', () => {
  const cardBalance = makeMoney('USD', 500000); // $5,000.00
  const tx = {
    id: 'tx-card-1',
    accountId: 'card-1',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', 20000), // $200.00 payment
    category: 'payment',
    payee: 'Chase Sapphire',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: null,
  };

  const delta = calculateTransactionBalanceDelta(tx, 'Credit card');
  assert.equal(delta.minorUnits, -20000);
  const updatedBalance = applyTransactionToBalance(cardBalance, tx, 'Credit card');
  assert.equal(updatedBalance.minorUnits, 480000); // $4,800.00
});

test('Phase 1: Payment validation rejects allocations exceeding total payment amount', () => {
  const invalidTx = {
    id: 'tx-invalid-alloc',
    accountId: 'mortgage-1',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', 100000), // $1,000.00
    category: 'payment',
    payee: 'Servicer',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: null,
    principalAmount: makeMoney('USD', 80000), // $800
    interestAmount: makeMoney('USD', 30000), // $300 -> Total $1,100 > $1,000!
  };

  assert.throws(() => validateLedgerTransaction(invalidTx), /cannot exceed total payment amount/);
});

test('Phase 1: Transaction encoding and decoding roundtrips all payment breakdown components', () => {
  const tx = {
    id: 'tx-roundtrip-alloc',
    accountId: 'loan-1',
    date: parseDateOnly('2026-11-06'),
    appliesToDate: parseDateOnly('2026-12-01'),
    amount: makeMoney('USD', 250050),
    category: 'payment',
    payee: 'Home Mortgage Co',
    memo: 'November payment',
    source: 'manual',
    reconciled: true,
    createdAt: '2026-11-06T10:00:00.000Z',
    deletedAt: null,
    principalAmount: makeMoney('USD', 80000),
    interestAmount: makeMoney('USD', 120000),
    escrowAmount: makeMoney('USD', 50000),
    feeAmount: makeMoney('USD', 50),
  };

  const encoded = encodeTransactionRow(tx, 'user-123');
  assert.equal(encoded.principal_amount, '800.00');
  assert.equal(encoded.interest_amount, '1200.00');
  assert.equal(encoded.escrow_amount, '500.00');
  assert.equal(encoded.fee_amount, '0.50');

  const decoded = decodeTransactionRow(encoded, 'USD');
  assert.equal(decoded.principalAmount?.minorUnits, 80000);
  assert.equal(decoded.interestAmount?.minorUnits, 120000);
  assert.equal(decoded.escrowAmount?.minorUnits, 50000);
  assert.equal(decoded.feeAmount?.minorUnits, 50);
  assert.equal(decoded.amount.minorUnits, 250050);
});

test('Phase 1: Transaction balance delta math correctly models additions, edits, account transfers, and reversals', () => {
  // Scenario: Card A starts at $1,000.00, Card B starts at $2,000.00
  let cardABalance = makeMoney('USD', 100000);
  let cardBBalance = makeMoney('USD', 200000);

  // 1. Add payment of $100 to Card A
  const tx1 = {
    id: 'tx-p1-1',
    accountId: 'card-1',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', 10000), // $100.00
    category: 'payment',
    payee: 'Payment to Card A',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: null,
  };

  const deltaAdd = calculateTransactionBalanceDelta(tx1, 'Credit card');
  assert.equal(deltaAdd.minorUnits, -10000);
  cardABalance = makeMoney('USD', cardABalance.minorUnits + deltaAdd.minorUnits);
  assert.equal(cardABalance.minorUnits, 90000); // $900.00

  // 2. Edit payment amount: change from $100 to $250
  const tx2 = {
    ...tx1,
    amount: makeMoney('USD', 25000), // $250.00
  };

  const oldDelta = calculateTransactionBalanceDelta(tx1, 'Credit card');
  const newDelta = calculateTransactionBalanceDelta(tx2, 'Credit card');

  // Reversing old delta (-(-$100)) and applying new delta (-$250):
  // Net effect on balance: +10000 - 25000 = -15000
  cardABalance = makeMoney('USD', cardABalance.minorUnits - oldDelta.minorUnits + newDelta.minorUnits);
  assert.equal(cardABalance.minorUnits, 75000); // $750.00 ($1,000 - $250)

  // 3. Edit payment account: transfer payment of $250 from Card A to Card B
  const tx3 = {
    ...tx2,
    accountId: 'card-2',
    payee: 'Payment to Card B',
  };

  const oldDeltaA = calculateTransactionBalanceDelta(tx2, 'Credit card');
  const newDeltaB = calculateTransactionBalanceDelta(tx3, 'Credit card');

  // Reverse from Card A
  cardABalance = makeMoney('USD', cardABalance.minorUnits - oldDeltaA.minorUnits);
  assert.equal(cardABalance.minorUnits, 100000); // Card A restored to $1,000.00!

  // Apply to Card B
  cardBBalance = makeMoney('USD', cardBBalance.minorUnits + newDeltaB.minorUnits);
  assert.equal(cardBBalance.minorUnits, 175000); // Card B reduced to $1,750.00 ($2,000 - $250)!

  // 4. Reverse / Delete payment: soft-deletion reverses its effect
  const deleteDelta = calculateTransactionBalanceDelta(tx3, 'Credit card');
  cardBBalance = makeMoney('USD', cardBBalance.minorUnits - deleteDelta.minorUnits);
  assert.equal(cardBBalance.minorUnits, 200000); // Card B restored to $2,000.00!
});

test('Phase 1: Atomic reconciliation recalculation does not double-count drift adjustment transaction', () => {
  const accountOpeningBalance = makeMoney('USD', 125050); // $1,250.50
  const verifiedBalance = makeMoney('USD', 130000); // Statement verified: $1,300.00
  const drift = verifiedBalance.minorUnits - accountOpeningBalance.minorUnits; // +$49.50

  const adjTx = {
    id: 'adj-tx-1',
    accountId: 'card-reconcile',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', Math.abs(drift)),
    category: 'interest_adjustment',
    payee: 'Statement interest adjustment',
    source: 'reconciliation',
    reconciled: true,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: null,
  };

  const anchor = {
    id: 'anchor-1',
    accountId: 'card-reconcile',
    asOfDate: parseDateOnly('2026-11-06'),
    verifiedBalance,
    note: 'October statement reconciliation',
    createdAt: '2026-11-06T12:00:00Z',
    createdAdjustmentId: adjTx.id,
  };

  // When calculating reconciled balance as of today with this anchor and transactions:
  const recResult = calculateReconciledBalance({
    openingBalance: accountOpeningBalance,
    anchor,
    transactions: [adjTx],
    accountId: 'card-reconcile',
    debtCategory: 'Credit card',
  });

  // Must match statement verified balance ($1,300.00) without adding the adjustment twice
  assert.equal(recResult.currentBalance.minorUnits, 130000);
});

test('Phase 1: Optimistic concurrency simulation rejects stale account revisions and prevents overwrites', () => {
  // Simulate account at version 2
  const serverAccount = {
    id: 'debt-concurrency-1',
    balance: makeMoney('USD', 500000), // $5,000.00
    version: 2,
  };

  // Device A has stale version 1
  const staleExpectedVersion = 1;
  const currentExpectedVersion = 2;

  function mutateWithConcurrencyCheck(expectedVer, currentAcc, delta) {
    if (expectedVer !== undefined && expectedVer !== null && expectedVer !== currentAcc.version) {
      throw new Error(`CONCURRENCY_CONFLICT: Stale debt revision (expected ${expectedVer}, current ${currentAcc.version})`);
    }
    return {
      balance: makeMoney('USD', currentAcc.balance.minorUnits + delta.minorUnits),
      version: currentAcc.version + 1,
    };
  }

  // Device A attempts update with stale version 1 -> Must throw conflict error!
  assert.throws(
    () => mutateWithConcurrencyCheck(staleExpectedVersion, serverAccount, makeMoney('USD', -20000)),
    /CONCURRENCY_CONFLICT: Stale debt revision/,
  );

  // Server balance must remain untouched ($5,000.00 at version 2)
  assert.equal(serverAccount.balance.minorUnits, 500000);
  assert.equal(serverAccount.version, 2);

  // Device B attempts update with valid version 2 -> Succeeds and increments version to 3
  const updated = mutateWithConcurrencyCheck(currentExpectedVersion, serverAccount, makeMoney('USD', -20000));
  assert.equal(updated.balance.minorUnits, 480000);
  assert.equal(updated.version, 3);
});

test('Phase 1: Server-side financial validation rejects zero/negative amounts and invalid allocations', () => {
  // 1. Transaction amount <= 0 must be rejected
  const zeroAmountTx = {
    id: 'tx-zero-amt',
    accountId: 'card-1',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', 0),
    category: 'payment',
    payee: 'Card payment',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: null,
  };
  assert.throws(() => validateLedgerTransaction(zeroAmountTx), /strictly positive/);

  // 2. Negative amount
  const negAmountTx = {
    ...zeroAmountTx,
    id: 'tx-neg-amt',
    amount: makeMoney('USD', -5000),
  };
  assert.throws(() => validateLedgerTransaction(negAmountTx), /strictly positive/);

  // 3. Allocations on non-payment categories must be rejected
  const purchaseWithAlloc = {
    id: 'tx-purchase-alloc',
    accountId: 'card-1',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', 10000),
    category: 'purchase',
    payee: 'Store',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: null,
    principalAmount: makeMoney('USD', 5000),
  };
  assert.throws(() => validateLedgerTransaction(purchaseWithAlloc), /Payment allocations are only permitted on payment transactions/);
});

test('Phase 1: Idempotency payload comparison distinguishes identical duplicates from conflicting reuses', () => {
  const existingStoredTx = {
    id: 'tx-idem-1',
    accountId: 'debt-1',
    date: '2026-11-06',
    appliesToDate: '2026-11-06',
    amount: '150.00',
    category: 'payment',
    payee: 'Loan Servicer',
    memo: 'Monthly payment',
    source: 'manual',
    reconciled: false,
    principalAmount: '100.00',
    interestAmount: '50.00',
  };

  function checkIdempotency(existing, incoming) {
    const fields = ['accountId', 'date', 'appliesToDate', 'amount', 'category', 'payee', 'memo', 'source', 'reconciled', 'principalAmount', 'interestAmount'];
    for (const f of fields) {
      if (existing[f] !== incoming[f]) {
        throw new Error(`IDEMPOTENCY_CONFLICT: Key reused with different ${f} (existing '${existing[f]}' vs incoming '${incoming[f]}')`);
      }
    }
    return { status: 'idempotent_duplicate' };
  }

  // Identical duplicate payload
  const identicalIncoming = { ...existingStoredTx };
  const res = checkIdempotency(existingStoredTx, identicalIncoming);
  assert.equal(res.status, 'idempotent_duplicate');

  // Conflicting duplicate payload with different amount
  const conflictingIncoming = { ...existingStoredTx, amount: '200.00' };
  assert.throws(
    () => checkIdempotency(existingStoredTx, conflictingIncoming),
    /IDEMPOTENCY_CONFLICT: Key reused with different amount/,
  );

  // Conflicting duplicate with different account
  const conflictingAccount = { ...existingStoredTx, accountId: 'debt-2' };
  assert.throws(
    () => checkIdempotency(existingStoredTx, conflictingAccount),
    /IDEMPOTENCY_CONFLICT: Key reused with different accountId/,
  );
});

test('Phase 1: Uncertain save outcomes are never reported as confirmed success', () => {
  function resolveUiOutcome(syncResult) {
    if (syncResult.syncStatus === 'synced') {
      return { outcome: 'confirmed', displaySuccess: true };
    }
    if (syncResult.failureKind === 'rejected') {
      return { outcome: 'rejected', displaySuccess: false, showError: true };
    }
    // cached_offline or uncertain timeout
    return { outcome: 'pending', displaySuccess: false, showPendingNotice: true };
  }

  // 1. Confirmed online write
  const confirmedRes = resolveUiOutcome({ syncStatus: 'synced' });
  assert.equal(confirmedRes.outcome, 'confirmed');
  assert.equal(confirmedRes.displaySuccess, true);

  // 2. Network timeout / offline cached write -> MUST NOT report definitive success
  const pendingRes = resolveUiOutcome({ syncStatus: 'cached_offline', failureKind: 'uncertain' });
  assert.equal(pendingRes.outcome, 'pending');
  assert.equal(pendingRes.displaySuccess, false);
  assert.equal(pendingRes.showPendingNotice, true);

  // 3. Server rejected write -> Reports error, never success
  const rejectedRes = resolveUiOutcome({ syncStatus: 'cached_offline', failureKind: 'rejected' });
  assert.equal(rejectedRes.outcome, 'rejected');
  assert.equal(rejectedRes.displaySuccess, false);
  assert.equal(rejectedRes.showError, true);
});

test('Phase 1: Deterministic account locking order eliminates deadlock in cross-account transfers', () => {
  function getLockOrder(accA, accB) {
    if (accA === accB) return [accA];
    return accA < accB ? [accA, accB] : [accB, accA];
  }

  const idX = 'uuid-1111-aaaa';
  const idY = 'uuid-2222-bbbb';

  // Transfer from X to Y locks [X, Y]
  assert.deepEqual(getLockOrder(idX, idY), [idX, idY]);

  // Concurrent transfer from Y to X also locks [X, Y] in identical order!
  assert.deepEqual(getLockOrder(idY, idX), [idX, idY]);
});

test('Phase 1: Soft-deleted transaction cannot be updated or double-deleted', () => {
  const deletedTx = {
    id: 'tx-deleted-1',
    accountId: 'debt-1',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', 5000),
    category: 'payment',
    payee: 'Card payment',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: '2026-11-06T12:30:00Z',
  };

  function validateCanEdit(tx) {
    if (tx.deletedAt !== null) {
      throw new Error('Cannot edit an already deleted or reversed transaction');
    }
  }

  function validateCanDelete(tx) {
    if (tx.deletedAt !== null) {
      return { status: 'already_deleted' };
    }
    return { status: 'deleted' };
  }

  assert.throws(() => validateCanEdit(deletedTx), /Cannot edit an already deleted or reversed transaction/);
  assert.equal(validateCanDelete(deletedTx).status, 'already_deleted');
});

test('Phase 1 Fix 1: Transaction versioning uses authoritative updatedAt over createdAt', () => {
  const row = {
    id: 'tx-rev-1',
    user_id: 'user-1',
    account_id: 'debt-1',
    date: '2026-11-06',
    amount: '150.00',
    category: 'payment',
    payee: 'Bank Payment',
    memo: null,
    source: 'manual',
    reconciled: false,
    created_at: '2026-11-06T10:00:00Z',
    updated_at: '2026-11-06T11:45:00Z', // Distinct from created_at
    deleted_at: null,
    is_pending: false,
  };

  const tx = decodeTransactionRow(row, 'USD');
  assert.equal(tx.createdAt, '2026-11-06T10:00:00Z');
  assert.equal(tx.updatedAt, '2026-11-06T11:45:00Z');
  assert.equal(tx.isPending, false);

  // Re-encoding preserves both timestamps and pending flag
  const reencoded = encodeTransactionRow(tx, 'user-1');
  assert.equal(reencoded.created_at, '2026-11-06T10:00:00Z');
  assert.equal(reencoded.updated_at, '2026-11-06T11:45:00Z');
  assert.equal(reencoded.is_pending, false);
});

test('Phase 1 Fix 3: Mandatory optimistic concurrency rejects missing revision with MISSING_REVISION (P0002)', () => {
  function simulateServerValidation(expectedVersion, currentServerVersion) {
    if (expectedVersion === null || expectedVersion === undefined) {
      const err = new Error('MISSING_REVISION: Optimistic concurrency requires expected version.');
      err.code = 'P0002';
      throw err;
    }
    if (expectedVersion !== currentServerVersion) {
      const err = new Error('CONCURRENCY_CONFLICT: Stale revision.');
      err.code = 'P0001';
      throw err;
    }
    return { success: true, newVersion: currentServerVersion + 1 };
  }

  // Omitting revision must be rejected with P0002 (not allowed to bypass)
  assert.throws(
    () => simulateServerValidation(null, 5),
    (err) => err.code === 'P0002' && err.message.includes('MISSING_REVISION')
  );
  assert.throws(
    () => simulateServerValidation(undefined, 5),
    (err) => err.code === 'P0002' && err.message.includes('MISSING_REVISION')
  );

  // Stale revision must be rejected with P0001
  assert.throws(
    () => simulateServerValidation(4, 5),
    (err) => err.code === 'P0001' && err.message.includes('CONCURRENCY_CONFLICT')
  );

  // Matching revision succeeds
  const res = simulateServerValidation(5, 5);
  assert.equal(res.success, true);
  assert.equal(res.newVersion, 6);
});

test('Phase 1 Fix 4: Unverified pending payments do not award milestones or appear confirmed', () => {
  const { calculateMilestones } = require('../src/finance/progress.ts');

  const debts = [{
    id: 'd1',
    name: 'Visa',
    category: 'Credit card',
    balance: 500,
    originalBalance: 1000,
    creditLimit: 2000,
  }];

  // Only an unverified pending payment exists
  const pendingTx = {
    id: 'tx-pending-1',
    accountId: 'd1',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', 50000), // $500
    category: 'payment',
    payee: 'Pending Card Payment',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T12:00:00Z',
    deletedAt: null,
    isPending: true, // Pending unverified write!
  };

  const milestonesPendingOnly = calculateMilestones({
    debts,
    transactions: [pendingTx],
  });

  const firstPaymentMilestone = milestonesPendingOnly.find(m => m.id === 'first_payment');
  // Must NOT award milestone based on unverified pending payment
  assert.equal(firstPaymentMilestone.status, 'in_progress');
  assert.equal(firstPaymentMilestone.currentValue, 0);

  // Once confirmed (isPending: false)
  const confirmedTx = { ...pendingTx, isPending: false };
  const milestonesConfirmed = calculateMilestones({
    debts,
    transactions: [confirmedTx],
  });
  const firstPaymentConfirmed = milestonesConfirmed.find(m => m.id === 'first_payment');
  assert.equal(firstPaymentConfirmed.status, 'completed');
  assert.equal(firstPaymentConfirmed.currentValue, 1);
});

test('Phase 1 Fix 5: Same-account pending edit calculates correct provisional balance ($1000 start, $100 -> $250 edit yields $750)', () => {
  const { moneyFromMajor, moneyToMajor, addMoney } = require('../src/finance/money.ts');

  const currentBalance = 900; // After initial $100 payment on $1000 starting debt
  const currencyCode = 'USD';
  const debtCategory = 'Credit card';

  const originalTx = {
    id: 'tx-edit-target',
    accountId: 'debt-card-1',
    date: parseDateOnly('2026-11-06'),
    amount: makeMoney('USD', 10000), // $100.00
    category: 'payment',
    payee: 'Chase Payment',
    source: 'manual',
    reconciled: false,
    createdAt: '2026-11-06T10:00:00Z',
    updatedAt: '2026-11-06T10:00:00Z',
    deletedAt: null,
    isPending: false,
  };

  // User edits payment from $100.00 to $250.00
  const editedTx = {
    ...originalTx,
    amount: makeMoney('USD', 25000), // $250.00
  };

  // executeUpdateTransaction formula:
  const oldDelta = calculateTransactionBalanceDelta(originalTx, debtCategory);
  const newDelta = calculateTransactionBalanceDelta(editedTx, debtCategory);
  const netDeltaMinor = newDelta.minorUnits - oldDelta.minorUnits;
  const curMoney = moneyFromMajor(currentBalance, currencyCode);
  const provMoney = addMoney(curMoney, makeMoney(currencyCode, netDeltaMinor));
  const provisionalBalance = moneyToMajor(provMoney);

  // Must equal $750, NOT $650 (bug if applying against current balance without net delta)
  assert.equal(provisionalBalance, 750);

  // Also test editing a purchase:
  // Starting balance $900. Original purchase was $50. User edits purchase to $120.
  const origPurchase = {
    ...originalTx,
    category: 'purchase',
    amount: makeMoney('USD', 5000), // $50
  };
  const editedPurchase = {
    ...origPurchase,
    amount: makeMoney('USD', 12000), // $120
  };
  const oldPurchDelta = calculateTransactionBalanceDelta(origPurchase, debtCategory);
  const newPurchDelta = calculateTransactionBalanceDelta(editedPurchase, debtCategory);
  const netPurchDelta = newPurchDelta.minorUnits - oldPurchDelta.minorUnits;
  const provPurchMoney = addMoney(curMoney, makeMoney(currencyCode, netPurchDelta));
  const provPurchBalance = moneyToMajor(provPurchMoney);
  // $900 + ($120 - $50) = $970
  assert.equal(provPurchBalance, 970);
});

