import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { Pool } from 'pg';
import { AccountService, AccountError, type CodeDelivery } from '../lib/server/account-service.ts';
import { createAccountHandler } from '../lib/server/account-http.ts';
import { migrateAccounts } from '../scripts/migrate-accounts.mjs';

test('real HTTP cookies persist registration/profile/login and password reset revokes prior sessions', { skip: !process.env.TEST_ACCOUNT_DATABASE_URL, timeout: 30000 }, async t => {
  const url = process.env.TEST_ACCOUNT_DATABASE_URL!;
  const target = new URL(url);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && /^\/teeko_(http|node|test)$/.test(target.pathname), 'Only a loopback disposable teeko test database is allowed.');
  await migrateAccounts(url);
  await migrateAccounts(url);
  const pool = new Pool({ connectionString: url, max: 5 });
  t.after(() => pool.end());
  await pool.query('TRUNCATE teeko_accounts,teeko_invitations,teeko_account_flows,teeko_sessions,teeko_profiles,teeko_auth_limits CASCADE');
  const delivered: CodeDelivery[] = [];
  const service = new AccountService(pool, { secret: 'local-http-fixture-protection-key-00000000', sendCode: async message => { delivered.push(message); } });
  let origin = '';
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join('; ') : value);
      const init: RequestInit & { duplex?: 'half' } = { method: incoming.method, headers };
      if (incoming.method !== 'GET' && incoming.method !== 'HEAD') { init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>; init.duplex = 'half'; }
      const handler = createAccountHandler({ service, origin, termsVersion: 'fixture-terms-v1', accountError: error => error instanceof AccountError ? error : null });
      const response = await handler(new Request(origin + incoming.url, init));
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => { if (key !== 'set-cookie') outgoing.setHeader(key, value); });
      if (response.headers.getSetCookie().length) outgoing.setHeader('set-cookie', response.headers.getSetCookie());
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.statusCode = 500; outgoing.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string'); origin = `http://127.0.0.1:${address.port}`;
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  function browser() {
    const cookies = new Map<string,string>();
    return { cookies, async request(path: string, body?: unknown, method = 'POST') {
      const response = await fetch(origin + '/api/v1' + path, { method: body === undefined ? 'GET' : method, headers: { Origin: origin, Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      for (const header of response.headers.getSetCookie()) { const pair = header.split(';')[0], i = pair.indexOf('='); if (/Max-Age=0/.test(header)) cookies.delete(pair.slice(0,i)); else cookies.set(pair.slice(0,i), pair.slice(i+1)); }
      return { status: response.status, data: await response.json() as Record<string, unknown> };
    } };
  }
  const visitor = browser();
  const [invitation] = await service.issueInvitations({ count: 1, expiresAt: new Date(Date.now()+86400000), issuedBy: 'http-test' });
  assert.equal((await visitor.request('/invitations/verify', { code: invitation.code })).status, 200);
  assert.equal((await visitor.request('/auth/state')).data.user, null);
  assert.equal((await visitor.request('/auth/code', { purpose: 'register', email: 'http-fixture@example.test' })).status, 200);
  assert.equal(delivered.length, 1);
  assert.equal((await visitor.request('/auth/verify', { purpose: 'register', code: delivered[0].code })).status, 200);
  assert.equal((await visitor.request('/auth/state')).data.user, null);
  const password = 'fixture-password-1', nextPassword = 'fixture-password-2';
  assert.equal((await visitor.request('/auth/register', { password, confirmation: password, agreed: true })).status, 200);
  assert.equal(visitor.cookies.has('teeko_flow'), false);
  assert.equal((await visitor.request('/courses')).status, 409);
  const profile = { name: 'Fixture', ageRange: '10–11', level: 'unsure' };
  assert.equal((await visitor.request('/profile', profile, 'PATCH')).status, 200);
  assert.deepEqual((await visitor.request('/profile')).data.profile, profile);
  assert.deepEqual((await visitor.request('/courses')).data.courses, []);
  const otherTab = browser();
  assert.equal((await otherTab.request('/auth/login', { email: 'http-fixture@example.test', password })).status, 200);
  assert.equal((await otherTab.request('/profile')).status, 200);
  const recovery = browser();
  assert.equal((await recovery.request('/auth/code', { purpose: 'reset', email: 'http-fixture@example.test' })).status, 200);
  assert.equal((await recovery.request('/auth/verify', { purpose: 'reset', code: delivered[1].code })).status, 200);
  assert.equal((await recovery.request('/auth/reset', { password: nextPassword, confirmation: nextPassword })).status, 200);
  assert.equal((await visitor.request('/profile')).status, 401);
  assert.equal((await otherTab.request('/profile')).status, 401);
  assert.equal((await recovery.request('/auth/login', { email: 'http-fixture@example.test', password })).status, 401);
  assert.equal((await recovery.request('/auth/login', { email: 'http-fixture@example.test', password: nextPassword })).status, 200);
  assert.equal((await recovery.request('/auth/logout', {})).status, 200);
  assert.equal((await recovery.request('/profile')).status, 401);
});
