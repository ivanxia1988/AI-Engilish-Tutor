import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountHandler, type AccountBackend } from '../lib/server/account-http.ts';

const origin = 'https://teeko.app';
const token = 's'.repeat(43), flow = 'f'.repeat(43);
function fixture() {
  const calls: string[] = [];
  const user = { id: 'account-a', email: 'fixture@example.test', profileComplete: false };
  const service: AccountBackend = {
    async verifyInvitation() { calls.push('invite'); return { flowToken: flow }; },
    async sendCode() { return { flowToken: flow, retryAfter: 60 }; },
    async verifyCode() { calls.push('verify'); },
    async register() { calls.push('register'); return { sessionToken: token, user }; },
    async login() { return { sessionToken: token, user }; },
    async reset() { calls.push('reset'); },
    async session(value) { return value === token ? user : null; },
    async flow() { return { purpose: 'register', stage: 'email' }; },
    async logout() { calls.push('logout'); }, async cancelFlow() { calls.push('cancel'); },
    async getProfile() { return null; }, async saveProfile(_id, profile) { calls.push('profile'); return profile; },
    async limit() { calls.push('limit'); },
  };
  const handler = createAccountHandler({ service, origin, termsVersion: 'test-v1', accountError: () => null });
  const request = (path: string, body: unknown, headers: Record<string,string> = {}, method = 'POST') => handler(new Request(`${origin}/api/v1${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  return { handler, request, calls, service };
}
test('cross-site or missing-origin writes are rejected before touching the backend', async () => {
  const f = fixture();
  for (const supplied of ['', 'https://evil.example', 'null']) assert.equal((await f.request('/auth/login', {}, { Origin: supplied })).status, 403);
  assert.deepEqual(f.calls, []);
});
test('large streamed JSON and invalid payloads never reach signup or profile writes', async () => {
  const f = fixture();
  assert.equal((await f.request('/auth/register', { password: 'p'.repeat(9000) })).status, 413);
  assert.equal((await f.request('/auth/register', { password: 'valid-fixture', confirmation: 'valid-fixture', agreed: true, accountId: 'other' }, { Cookie: `teeko_flow=${flow}` })).status, 400);
  assert.equal((await f.request('/profile', { name: 'Fixture', ageRange: '10–11', level: 'unsure', accountId: 'other' }, { Cookie: `teeko_session=${token}` }, 'PATCH')).status, 400);
  assert(!f.calls.includes('register') && !f.calls.includes('profile'));
});
test('invitation proof and session tokens appear only in protected cookies', async () => {
  const f = fixture();
  const invited = await f.request('/invitations/verify', { code: 'TEST-FIXTURE' });
  assert.deepEqual(await invited.json(), { ok: true, next: '/login?intent=register' });
  assert.match(invited.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax.*Secure/);
  const registered = await f.request('/auth/register', { password: 'valid-fixture', confirmation: 'valid-fixture', agreed: true }, { Cookie: `teeko_flow=${flow}` });
  assert.deepEqual(await registered.json(), { ok: true, next: '/onboarding' });
  assert.equal(registered.headers.getSetCookie().length, 2);
  assert.match(registered.headers.getSetCookie()[0], /teeko_session=.*HttpOnly/);
  assert.match(registered.headers.getSetCookie()[1], /teeko_flow=;.*Max-Age=0/);
});
test('state and profile fail closed on forged identity headers and ambiguous cookies', async () => {
  const f = fixture();
  const forged = await f.handler(new Request(`${origin}/api/v1/profile`, { headers: { 'oai-authenticated-user-id': 'forged', Cookie: `teeko_session=${token}; teeko_session=${flow}` } }));
  assert.equal(forged.status, 401);
  const state = await f.handler(new Request(`${origin}/api/v1/auth/state`));
  assert.match(state.headers.get('cache-control')!, /no-store/);
  const stateBody = await state.json() as { user: unknown };
  assert.equal(stateBody.user, null);
});
test('unknown database or provider errors are sanitized without leaking details', async () => {
  const f = fixture();
  f.service.login = async () => { throw new Error('database-secret-fixture'); };
  const response = await f.request('/auth/login', { email: 'fixture@example.test', password: 'valid-fixture' });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /database-secret-fixture/);
});

test('post-commit flow cleanup cannot turn a committed registration into a lost session', async () => {
  const f = fixture();
  f.service.cancelFlow = async () => { throw new Error('cleanup failed'); };
  const response = await f.request('/auth/register', { password: 'valid-fixture', confirmation: 'valid-fixture', agreed: true }, { Cookie: `teeko_flow=${flow}` });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie')!, /teeko_session=/);
});
