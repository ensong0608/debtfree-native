import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedSandbox, callbackCode, parseCallback, parseRecoveryCallback, sandboxConfigProblem, classifyAuthError, isEmailPasswordAuthEnabled, validateEmailInput, validateEmailPasswordInput, CALLBACK, RECOVERY_CALLBACK, PRODUCTION_PROJECT_REF } from '../src/auth-guards.ts';

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

test('configuration problems name the variable and rule without echoing values', () => {
  const key = 'sb_publishable_abcdef';
  assert.equal(sandboxConfigProblem('https://sandbox123.supabase.co', 'sandbox123', key), null);
  assert.match(sandboxConfigProblem('', '', ''), /EXPO_PUBLIC_SANDBOX_SUPABASE_URL, EXPO_PUBLIC_SANDBOX_PROJECT_REF, EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(sandboxConfigProblem('https://sandbox123.supabase.co', 'sandbox123', ''), /^Missing EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY\.$/);
  assert.match(sandboxConfigProblem(`https://${PRODUCTION_PROJECT_REF}.supabase.co`, PRODUCTION_PROJECT_REF, key), /production project is not allowed/);
  assert.match(sandboxConfigProblem('http://sandbox123.supabase.co', 'sandbox123', key), /must be exactly https/);
  assert.match(sandboxConfigProblem('https://sandbox123.supabase.co/rest/v1', 'sandbox123', key), /must be exactly https/);
  assert.match(sandboxConfigProblem('https://sandbox123.supabase.co', 'Sandbox_123', key), /not a valid project reference/);
  const secretProblem = sandboxConfigProblem('https://sandbox123.supabase.co', 'sandbox123', 'sb_secret_topsecretvalue');
  assert.match(secretProblem, /publishable/);
  assert.ok(!secretProblem.includes('topsecretvalue'));
  // A legacy JWT (anon or service_role) is rejected by shape.
  assert.match(sandboxConfigProblem('https://sandbox123.supabase.co', 'sandbox123', 'eyJhbGciOiJIUzI1NiJ9.e30.sig'), /publishable/);
});

test('callback errors are classified so cancellation/denial is distinguishable from tampering', () => {
  assert.deepEqual(parseCallback(`${CALLBACK}?error=access_denied&error_description=denied`), { kind: 'error', reason: 'access_denied' });
  assert.deepEqual(parseCallback(`${CALLBACK}#error=server_error&error_description=x`), { kind: 'error', reason: 'provider' });
  assert.deepEqual(parseCallback(`${CALLBACK}?error=access_denied&code=abc`), { kind: 'error', reason: 'access_denied' });
  assert.deepEqual(parseCallback(`${CALLBACK}?code=abc`), { kind: 'code', code: 'abc' });
  // A wrong host must not be reported as a provider error, even if it carries one.
  assert.deepEqual(parseCallback('com.debtfree.native.test://other/callback?error=access_denied'), { kind: 'invalid' });
  assert.deepEqual(parseCallback('https://evil.test/auth/callback?code=abc'), { kind: 'invalid' });
  assert.deepEqual(parseCallback(`${CALLBACK}?code=abc#access_token=leaked`), { kind: 'invalid' });
  assert.deepEqual(parseCallback(`${CALLBACK}/extra?code=abc`), { kind: 'invalid' });
  assert.deepEqual(parseCallback(`${CALLBACK}`), { kind: 'invalid' });
  assert.deepEqual(parseRecoveryCallback(`${RECOVERY_CALLBACK}&code=rec123`), { kind: 'code', code: 'rec123' });
  assert.deepEqual(parseRecoveryCallback(`${CALLBACK}?code=rec123`), { kind: 'invalid' });
});

test('auth errors separate temporary failures from definitive rejections', () => {
  assert.equal(classifyAuthError({ name: 'AuthRetryableFetchError', status: 0 }), 'network');
  assert.equal(classifyAuthError(new TypeError('Network request failed')), 'network');
  assert.equal(classifyAuthError({ name: 'AuthApiError', status: 503 }), 'network');
  assert.equal(classifyAuthError({ name: 'AuthApiError', status: 429 }), 'network');
  assert.equal(classifyAuthError({ name: 'AuthApiError', status: 403, code: 'bad_jwt' }), 'invalid');
  assert.equal(classifyAuthError({ name: 'AuthApiError', status: 401 }), 'invalid');
  assert.equal(classifyAuthError({ name: 'AuthApiError', status: 400, code: 'refresh_token_already_used' }), 'invalid');
  assert.equal(classifyAuthError({ name: 'AuthSessionMissingError', status: 400 }), 'invalid');
  assert.equal(classifyAuthError({ name: 'AuthApiError', code: 'session_not_found' }), 'invalid');
  assert.equal(classifyAuthError(new Error('boom')), 'unknown');
  assert.equal(classifyAuthError(null), 'unknown');
});


test('email authentication is enabled by default outside production and explicitly gated in production', () => {
  assert.equal(isEmailPasswordAuthEnabled('sandbox', undefined), true);
  assert.equal(isEmailPasswordAuthEnabled('sandbox', 'false'), false);
  assert.equal(isEmailPasswordAuthEnabled('production', undefined), false);
  assert.equal(isEmailPasswordAuthEnabled('production', 'true'), true);
  assert.equal(isEmailPasswordAuthEnabled('production', 'false'), false);
});

test('email and password validation trims email and requires six password characters', () => {
  assert.equal(validateEmailInput(' user@example.com '), null);
  for (const email of ['', 'bad', 'a@b', 'a b@example.com']) assert.match(validateEmailInput(email), /email/i);
  assert.equal(validateEmailPasswordInput(' user@example.com ', '123456'), null);
  for (const email of ['', 'bad', 'a@b', 'a b@example.com']) assert.match(validateEmailPasswordInput(email, '123456'), /email/i);
  assert.match(validateEmailPasswordInput('a@example.com', '12345'), /6 characters/);
});

test('email auth errors are classified by server code', () => {
  for (const [code, expected] of Object.entries({ invalid_credentials: 'invalid_credentials', email_not_confirmed: 'email_not_confirmed', user_already_exists: 'user_already_registered', weak_password: 'weak_password', over_request_rate_limit: 'rate_limit', over_email_send_rate_limit: 'rate_limit' })) {
    assert.equal(classifyAuthError({ code, status: 400 }), expected);
  }
});
