import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryDiagnostics, recoveryFailure, resolveRecoverySourceContext } from '../src/recovery-domain.ts';
import { resolveDatabaseDebtCategory } from '../src/debt-storage-domain.ts';

test('invalid categories retain exact identity and context without financial amounts', () => {
  const rows = [{ id: 'one', name: 'Card', category: null, version: 7, balance: 123 }, { id: 'two', name: 'Loan', category: 'unknown', version: '8', balance: 456 }];
  const diagnostics = categoryDiagnostics(rows, value => resolveDatabaseDebtCategory(value, undefined));
  assert.deepEqual(diagnostics, [{ id: 'one', name: 'Card', issue: 'Missing category', version: 7, category: null }, { id: 'two', name: 'Loan', issue: 'Unsupported category', version: '8', category: 'unknown' }]);
  const context = { userId: 'u', householdId: 'h', role: 'owner', membershipVersion: '1' };
  assert.deepEqual(recoveryFailure(true, context, [context], diagnostics), { route: 'recovery', context, summaries: [context], diagnostics });
  assert.equal(recoveryFailure(false, context, [context], diagnostics).route, 'unavailable');
});

test('invitation entry with no memberships does not require loading or creating a household', async () => {
  assert.equal(await resolveRecoverySourceContext('u', null, async () => [], async () => { throw new Error('must not load'); }), null);
});

test('recovery retains the diagnosed source so switching can check its pending writes', async () => {
  const context = { userId: 'u', householdId: 'broken', role: 'owner', membershipVersion: '3' };
  const unexpected = async () => { throw new Error('must not replace the known source'); };
  assert.equal(await resolveRecoverySourceContext('u', context, unexpected, unexpected), context);
});

test('membership discovery failures do not silently bypass the source-household check', async () => {
  await assert.rejects(resolveRecoverySourceContext('u', null, async () => { throw new Error('offline'); }, async () => null), /offline/);
});
