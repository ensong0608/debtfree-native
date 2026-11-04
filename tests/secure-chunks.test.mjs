import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createChunkedStorage, splitByBytes, MAX_CHUNK_BYTES } from '../src/secure-chunks.ts';

function memoryStore({ failSetOn } = {}) {
  const map = new Map();
  let sets = 0;
  return {
    map,
    async getItem(key) { return map.has(key) ? map.get(key) : null; },
    async setItem(key, value) {
      sets++;
      if (failSetOn && failSetOn(key, sets)) throw new Error('keystore unavailable');
      if (Buffer.byteLength(value, 'utf8') > 2048) throw new Error('value too large');
      map.set(key, value);
    },
    async removeItem(key) { map.delete(key); },
  };
}
let counter = 0;
const ids = () => `gen${++counter}`;
const largeSession = JSON.stringify({ access_token: 'a'.repeat(2400), refresh_token: 'r'.repeat(40), user: { user_metadata: { full_name: 'ZoÃ« Ã‘andÃº ðŸ˜€'.repeat(60), avatar_url: 'https://x.test/' + 'p'.repeat(900) } } });

test('large sessions round-trip without any single entry exceeding the platform limit', async () => {
  assert.ok(Buffer.byteLength(largeSession) > 2048 * 2);
  const store = memoryStore();
  const storage = createChunkedStorage(store, ids);
  await storage.setItem('sb-ref-auth-token', largeSession);
  assert.equal(await storage.getItem('sb-ref-auth-token'), largeSession);
  for (const value of store.map.values()) assert.ok(Buffer.byteLength(value) <= MAX_CHUNK_BYTES);
});

test('splitting never breaks a multi-byte character', () => {
  const value = 'ðŸ˜€Ã©'.repeat(1000);
  const parts = splitByBytes(value, 7);
  assert.equal(parts.join(''), value);
  for (const part of parts) {
    assert.ok(Buffer.byteLength(part) <= 7);
    assert.ok(!/[\uD800-\uDBFF]$/.test(part), 'chunk ends with a lone high surrogate');
  }
  assert.deepEqual(splitByBytes(''), ['']);
});

test('overwrites and removals leave no stale chunks behind', async () => {
  const store = memoryStore();
  const storage = createChunkedStorage(store, ids);
  await storage.setItem('k', largeSession);
  await storage.setItem('k', 'small');
  assert.equal(await storage.getItem('k'), 'small');
  assert.equal(store.map.size, 2);
  await storage.removeItem('k');
  assert.equal(await storage.getItem('k'), null);
  assert.equal(store.map.size, 0);
});

test('an interrupted write keeps the previous value and cleans up partial chunks', async () => {
  let failing = false;
  const store = memoryStore({ failSetOn: () => failing });
  const storage = createChunkedStorage(store, ids);
  await storage.setItem('k', 'previous-session');
  const before = new Map(store.map);
  failing = true;
  await assert.rejects(storage.setItem('k', largeSession), /keystore unavailable/);
  failing = false;
  assert.equal(await storage.getItem('k'), 'previous-session');
  assert.deepEqual(store.map, before);
});

test('a failure while writing the manifest does not expose the new value', async () => {
  const store = memoryStore({ failSetOn: key => key === 'k' });
  const storage = createChunkedStorage(store, ids);
  await assert.rejects(storage.setItem('k', largeSession));
  assert.equal(await storage.getItem('k'), null);
  assert.equal(store.map.size, 0);
});

test('missing chunks are treated as no value instead of a truncated session', async () => {
  const store = memoryStore();
  const storage = createChunkedStorage(store, ids);
  await storage.setItem('k', largeSession);
  const chunk = [...store.map.keys()].find(key => key.endsWith('.1'));
  store.map.delete(chunk);
  assert.equal(await storage.getItem('k'), null);
});

test('values stored before chunking are still readable and removable', async () => {
  const store = memoryStore();
  store.map.set('k', '{"legacy":true}');
  const storage = createChunkedStorage(store, ids);
  assert.equal(await storage.getItem('k'), '{"legacy":true}');
  await storage.removeItem('k');
  assert.equal(await storage.getItem('k'), null);
});

test('read failures propagate so callers can report unavailable secure storage', async () => {
  const store = memoryStore();
  store.getItem = async () => { throw new Error('keystore locked'); };
  const storage = createChunkedStorage(store, ids);
  await assert.rejects(storage.getItem('k'), /keystore locked/);
});
