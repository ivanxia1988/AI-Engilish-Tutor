import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeEmailError, prototypeLoginError } from '../lib/prototype-auth.ts';
import * as auth from '../lib/prototype-auth.ts';

test('email login accepts an email address and rejects phone numbers or incomplete addresses', () => {
  assert.equal(prototypeEmailError(' parent@example.com '), null);
  for (const email of ['', '13800000000', 'parent', 'parent@', 'parent@ example.com', 'parent@example']) {
    assert.equal(prototypeEmailError(email), '请输入有效的邮箱地址。');
  }
});

test('prototype verification requires a code issued to the current email and agreement', () => {
  const valid = { email: 'parent@example.com', code: '123456', consent: true, codeSentTo: 'parent@example.com' };
  assert.equal(prototypeLoginError(valid), null);
  assert.equal(prototypeLoginError({ ...valid, email: ' Parent@Example.com ' }), null);
  assert.equal(prototypeLoginError({ ...valid, codeSentTo: '' }), '请先获取邮箱验证码。');
  assert.equal(prototypeLoginError({ ...valid, email: 'other@example.com' }), '请先获取邮箱验证码。');
  assert.equal(prototypeLoginError({ ...valid, code: '654321' }), '验证码不正确，请重新输入。');
  assert.equal(prototypeLoginError({ ...valid, code: '' }), '验证码不正确，请重新输入。');
  assert.equal(prototypeLoginError({ ...valid, consent: false }), '请阅读并同意《用户协议》。');
});

const email = 'learner@example.com', password = 'Example123!';
test('registration starts with an invitation and cannot request an email code without it', () => {
  const state = auth.navigatePrototypeAuth(auth.createPrototypeAuth(), 'register');
  assert.equal(state.stage, 'invite');
  const bypass = { ...state, stage: 'register' as const, email };
  const result = auth.requestPrototypeCode(bypass, 1000);
  assert.equal(result.issued, null);
  assert.match(result.error, /邀请码/);
});

test('password completion cannot bypass the invitation even with verified email', async () => {
  const state = { ...auth.createPrototypeAuth(), stage: 'set-password' as const, email, password, confirmation: password, consent: true, verified: { email, purpose: 'register' as const, expiresAt: 10000 } };
  const result = await auth.submitPrototypeAuth(state, 1001);
  assert.equal(result.destination, undefined);
  assert.match(result.state.error, /邀请码/);
  assert.equal(Object.keys(result.state.accounts).length, 0);
});

async function register() {
  let state = auth.verifyPrototypeInvitation(auth.createPrototypeAuth(), 'TEEKO-TRY', 1000);
  state = auth.changePrototypeAuth(state, { email, consent: true });
  state = auth.requestPrototypeCode(state, 1000);
  state = auth.changePrototypeAuth(state, { code: '123456' });
  state = (await auth.submitPrototypeAuth(state, 1001)).state;
  return auth.submitPrototypeAuth(auth.changePrototypeAuth(state, { password, confirmation: password }), 1002);
}

test('registration verifies email before setting a password and entering profile', async () => {
  assert.equal(typeof auth.createPrototypeAuth, 'function');
  let state = auth.verifyPrototypeInvitation(auth.createPrototypeAuth(), 'TEEKO-TRY', 1000);
  state = auth.changePrototypeAuth(state, { email, consent: true });
  let result = await auth.submitPrototypeAuth(state, 1000);
  assert.equal(result.destination, undefined);
  assert.match(result.state.error, /获取.*验证码/);
  state = auth.requestPrototypeCode(state, 1000);
  state = auth.changePrototypeAuth(state, { code: '123456' });
  result = await auth.submitPrototypeAuth(state, 1001);
  assert.equal(result.state.stage, 'set-password');
  assert.equal(result.destination, undefined);
  assert.equal(Object.keys(result.state.accounts).length, 0);
  result = await auth.submitPrototypeAuth(auth.changePrototypeAuth(result.state, { password, confirmation: password }), 1002);
  assert.equal(result.destination, 'profile');
  assert.notEqual(result.state.accounts[email].digest, password);
  assert.equal(result.state.password, '');
  assert.equal(result.state.confirmation, '');
});

test('verification expires, is bound to email and purpose, and requires agreement for signup', async () => {
  let state = auth.verifyPrototypeInvitation(auth.createPrototypeAuth(), 'TEEKO-TRY', 1000);
  state = auth.requestPrototypeCode(auth.changePrototypeAuth(state, { email }), 1000);
  state = auth.changePrototypeAuth(state, { code: '123456' });
  assert.match((await auth.submitPrototypeAuth(state, 1001)).state.error, /用户协议/);
  state = auth.changePrototypeAuth(state, { consent: true });
  assert.match((await auth.submitPrototypeAuth(state, 301001)).state.error, /过期/);
  const edited = auth.changePrototypeAuth(state, { email: 'other@example.com' });
  assert.equal(edited.issued, null);
  assert.equal(edited.code, '');
  assert.equal((await auth.submitPrototypeAuth(edited, 1001)).destination, undefined);
  const switched = auth.navigatePrototypeAuth(state, 'recover');
  assert.equal(switched.issued, null);
  assert.equal(switched.verified, null);
  const bypass = { ...state, stage: 'set-password' as const, password, confirmation: password };
  assert.match((await auth.submitPrototypeAuth(bypass, 1001)).state.error, /验证/);
});

test('password setup rejects short, oversized and mismatched passwords', async () => {
  assert.match(auth.prototypePasswordError('short', 'short')!, /8.*64/);
  assert.match(auth.prototypePasswordError('a'.repeat(65), 'a'.repeat(65))!, /8.*64/);
  assert.match(auth.prototypePasswordError(password, 'different')!, /一致/);
  assert.equal(auth.prototypePasswordError(password, password), null);
});

test('password login checks credentials and resumes unfinished profile', async () => {
  const created = await register();
  let state = auth.navigatePrototypeAuth(created.state, 'login');
  const login = async (value: string) => auth.submitPrototypeAuth(auth.changePrototypeAuth(state, { email: ' Learner@Example.com ', password: value }), 1003);
  assert.equal((await login('incorrect')).destination, undefined);
  assert.equal((await login(password.toLowerCase())).destination, undefined);
  let result = await login(password);
  assert.equal(result.destination, 'profile');
  state = auth.markPrototypeProfileComplete(result.state);
  result = await login(password);
  assert.equal(result.destination, 'home');
  assert.equal(result.state.password, '');
});

test('recovery requires its own code and replacement invalidates the old password', async () => {
  const created = await register();
  let state = auth.navigatePrototypeAuth(created.state, 'recover');
  state = auth.changePrototypeAuth(state, { email });
  assert.equal((await auth.submitPrototypeAuth(state, 2000)).destination, undefined);
  state = auth.requestPrototypeCode(state, 2000);
  state = (await auth.submitPrototypeAuth(auth.changePrototypeAuth(state, { code: '123456' }), 2001)).state;
  assert.equal(state.stage, 'reset-password');
  const newPassword = 'Another123!';
  state = (await auth.submitPrototypeAuth(auth.changePrototypeAuth(state, { password: newPassword, confirmation: newPassword }), 2002)).state;
  assert.equal(state.stage, 'login');
  assert.match(state.message, /重置/);
  assert.equal((await auth.submitPrototypeAuth(auth.changePrototypeAuth(state, { password }), 2003)).destination, undefined);
  assert.equal((await auth.submitPrototypeAuth(auth.changePrototypeAuth(state, { password: newPassword }), 2003)).destination, 'profile');
});

test('leaving password setup revokes verification and never stores draft passwords', async () => {
  const created = await register();
  let state = auth.navigatePrototypeAuth(created.state, 'recover');
  state = auth.requestPrototypeCode(auth.changePrototypeAuth(state, { email }), 1000);
  state = (await auth.submitPrototypeAuth(auth.changePrototypeAuth(state, { code: '123456' }), 1001)).state;
  state = auth.changePrototypeAuth(state, { password, confirmation: password });
  state = auth.navigatePrototypeAuth(state, 'login');
  assert.equal(state.verified, null);
  assert.equal(state.password, '');
  assert.equal(state.confirmation, '');
  assert.equal(state.code, '');
});


test('invitation validation handles unknown, expired and disabled codes and normalizes input', () => {
  const state = auth.createPrototypeAuth();
  for (const [value, message] of [['', /输入/], ['wrong', /不正确/], ['toString', /不正确/], ['TEEKO-EXPIRED', /过期/], ['TEEKO-OFF', /停用/]] as const) {
    const result = auth.verifyPrototypeInvitation(state, value, 1000);
    assert.equal(result.stage, 'invite');
    assert.equal(result.invitation, null);
    assert.match(result.error, message);
  }
  const accepted = auth.verifyPrototypeInvitation(state, ' teeko-try ', 1000);
  assert.equal(accepted.stage, 'register');
  assert.equal(accepted.invitation?.code, 'TEEKO-TRY');
  assert.equal(accepted.invitations['TEEKO-TRY'].redeemedBy, null);
});

test('an invitation is consumed by completed registration and cannot create a second account', async () => {
  const created = await register();
  assert.equal(created.state.invitations['TEEKO-TRY'].redeemedBy, email);
  assert.equal(created.state.invitation, null);
  const reused = auth.verifyPrototypeInvitation(created.state, 'TEEKO-TRY', 1003);
  assert.equal(reused.stage, 'invite');
  assert.match(reused.error, /已使用/);
  assert.equal(Object.keys(reused.accounts).length, 1);
  const other = auth.verifyPrototypeInvitation(created.state, 'TEEKO-NEXT', 1003);
  assert.equal(other.stage, 'register');
  assert.equal(other.accounts[email].digest, created.state.accounts[email].digest);
});

test('leaving registration revokes invitation proof without consuming the code', () => {
  const accepted = auth.verifyPrototypeInvitation(auth.createPrototypeAuth(), 'TEEKO-TRY', 1000);
  const left = auth.navigatePrototypeAuth(accepted, 'login');
  assert.equal(left.invitation, null);
  assert.equal(auth.navigatePrototypeAuth(left, 'register').stage, 'invite');
  assert.equal(left.invitations['TEEKO-TRY'].redeemedBy, null);
  assert.equal(auth.verifyPrototypeInvitation(left, 'TEEKO-TRY', 1001).stage, 'register');
  const expired = auth.requestPrototypeCode(auth.changePrototypeAuth(accepted, { email }), 901000);
  assert.match(expired.error, /邀请码.*过期/);
  assert.equal(expired.issued, null);
});

test('leaving the auth screen for review or hash navigation clears all draft proofs', () => {
  let state = auth.verifyPrototypeInvitation(auth.createPrototypeAuth(), 'TEEKO-TRY', 1000);
  state = auth.requestPrototypeCode(auth.changePrototypeAuth(state, { email, consent: true }), 1001);
  const left = auth.leavePrototypeAuth({ ...state, authenticatedEmail: email, password: 'draft', confirmation: 'draft' });
  assert.equal(left.stage, 'login');
  assert.equal(left.invitation, null);
  assert.equal(left.issued, null);
  assert.equal(left.verified, null);
  assert.equal(left.password, '');
  assert.equal(left.confirmation, '');
  assert.equal(left.authenticatedEmail, email);
  assert.equal(left.invitations['TEEKO-TRY'].redeemedBy, null);
});
