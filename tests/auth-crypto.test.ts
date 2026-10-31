import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, newToken, newOtp, protectedDigest } from '../lib/server/auth-crypto.ts';

test('password hashes use unique salts and reject a wrong password or malformed encoded cost', async () => {
  const first = await hashPassword('fixture-pass-123');
  const second = await hashPassword('fixture-pass-123');
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$32768\$8\$3\$/);
  assert.equal(await verifyPassword('fixture-pass-123', first), true);
  assert.equal(await verifyPassword('different-pass', first), false);
  assert.equal(await verifyPassword('fixture-pass-123', first.replace('32768', '999999999')), false);
  assert.equal(await verifyPassword('fixture-pass-123', 'garbage'), false);
  await assert.rejects(hashPassword('short'));
});

test('tokens and codes have independent entropy and protected digests bind their purpose', () => {
  const token = newToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newToken(), token);
  assert.match(newOtp(), /^\d{6}$/);
  const secret = 'test-only-key-material-with-at-least-32-bytes';
  assert.notEqual(protectedDigest(secret, 'session', token), protectedDigest(secret, 'flow', token));
  assert.notEqual(protectedDigest(secret, 'session', token), token);
});
