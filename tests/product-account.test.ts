import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_UNAVAILABLE, accountIntent, accountSubmissionError, invitationSubmissionError } from '../components/product/account-state.ts';

test('public invitation does not accept review codes or invent verified invitations', () => {
  assert.equal(invitationSubmissionError(''), '请输入邀请码。');
  for (const code of ['TEEKO-TRY', 'TEEKO-NEXT', 'some-private-invite']) {
    assert.equal(invitationSubmissionError(code), ACCOUNT_UNAVAILABLE);
  }
});
test('valid login, registration and recovery stop at unavailable account service', () => {
  const fields = { email: 'learner@example.com', password: 'not-a-real-password', invitation: 'some-private-invite' };
  for (const intent of ['login', 'register', 'recover'] as const) assert.equal(accountSubmissionError(intent, fields), ACCOUNT_UNAVAILABLE);
});
test('local validation does not claim to send recovery emails or authenticate incomplete input', () => {
  const empty = { email: '', password: '', invitation: '' };
  assert.equal(accountSubmissionError('register', empty), '请输入邀请码。');
  assert.equal(accountSubmissionError('recover', empty), '请输入有效的邮箱地址。');
  assert.equal(accountSubmissionError('login', { ...empty, email: 'learner@example.com' }), '请输入密码。');
  assert.equal(accountIntent('register'), 'register');
  assert.equal(accountIntent('recover'), 'recover');
  assert.equal(accountIntent('anything'), 'login');
});
