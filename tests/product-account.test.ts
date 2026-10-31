import test from 'node:test';
import assert from 'node:assert/strict';
import { accountIntent, accountSubmissionError, invitationSubmissionError, passwordSubmissionError } from '../components/product/account-state.ts';
import { accountRequest, destination, completed } from '../components/product/account-request.ts';

test('local account validation permits valid input without granting an account or verifying invitation', () => {
  assert.equal(invitationSubmissionError(''), '请输入邀请码。');
  assert.equal(invitationSubmissionError('a-private-invitation'), '');
  const fields = { email: 'learner@example.com', password: 'not-a-real-password', invitation: 'a-private-invitation' };
  for (const intent of ['login', 'register', 'recover'] as const) assert.equal(accountSubmissionError(intent, fields), '');
  assert.equal(accountIntent('register'), 'register'); assert.equal(accountIntent('recover'), 'recover'); assert.equal(accountIntent('other'), 'login');
});
test('password validation requires confirmation and the server password length range', () => {
  assert(passwordSubmissionError('short', 'short'));
  assert(passwordSubmissionError('valid-password', 'another-password'));
  assert(passwordSubmissionError('x'.repeat(65), 'x'.repeat(65)));
  assert.equal(passwordSubmissionError('valid-password', 'valid-password'), '');
});
test('API requests use same-origin cookies and reject arbitrary redirect destinations', async () => {
  const original = globalThis.fetch;
  const calls: RequestInit[] = [];
  try {
    globalThis.fetch = async (_input, init) => { calls.push(init!); return Response.json({ ok: true, next: 'https://outside.example' }); };
    await assert.rejects(accountRequest('/auth/login', destination, { body: { email: 'learner@example.com', password: 'not-a-real-password' } }), /服务响应异常/);
    assert.equal(calls[0].credentials, 'same-origin'); assert.equal(calls[0].cache, 'no-store');
    assert.equal(calls[0].method, 'POST'); assert.equal((calls[0].headers as Record<string, string>)['Content-Type'], 'application/json');
  } finally { globalThis.fetch = original; }
});
test('API errors display bounded server messages and malformed errors remain generic', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ ok: false, error: { code: 'INVITE_EXPIRED', message: '邀请码已过期。' } }, { status: 400 });
    await assert.rejects(accountRequest('/invitations/verify', completed, { body: { code: 'a-private-invitation' } }), /邀请码已过期/);
    globalThis.fetch = async () => new Response('internal stack or secret detail', { status: 503 });
    await assert.rejects(accountRequest('/auth/state', completed), /服务响应异常/);
    globalThis.fetch = async () => { throw new TypeError('network detail'); };
    await assert.rejects(accountRequest('/auth/state', completed), /连接未成功/);
  } finally { globalThis.fetch = original; }
});
