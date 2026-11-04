import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedSandbox, callbackCode, CALLBACK } from '../src/auth-guards.ts';

test('only matching test project URL and publishable key are accepted', () => {
  assert.equal(isAllowedSandbox('https://sandbox123.supabase.co', 'sandbox123', 'sb_publishable_123'), true);
  for (const args of [
    ['https://acpderotiyoecmwwyfsu.supabase.co', 'acpderotiyoecmwwyfsu', 'sb_publishable_x'],
    ['https://sandbox123.supabase.co.evil.test', 'sandbox123', 'sb_publishable_x'],
    ['https://sandbox123.supabase.co:444', 'sandbox123', 'sb_publishable_x'],
    ['https://sandbox123.supabase.co', 'sandbox123', 'sb_secret_x'],
    ['https://sandbox123.supabase.co', 'different', 'sb_publishable_x'],
    ['', '', ''],
  ]) assert.equal(isAllowedSandbox(...args), false);
});
test('OAuth callback is limited to the app callback and exactly one code', () => {
  assert.equal(callbackCode(`${CALLBACK}?code=one`), 'one');
  for (const value of [`${CALLBACK}?code=one&code=two`, `${CALLBACK}?code=one#error`, `${CALLBACK}?error=x&code=one`, 'com.debtfree.native.test://evil/callback?code=x', `${CALLBACK}?code=`, 'bad url']) assert.equal(callbackCode(value), null);
});
