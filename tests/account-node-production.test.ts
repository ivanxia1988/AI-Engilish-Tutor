import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrateAccounts } from '../scripts/migrate-accounts.mjs';
import { AccountService } from '../lib/server/account-service.ts';

const database = process.env.TEST_ACCOUNT_DATABASE_URL;
const enabled = process.env.TEEKO_ACCOUNT_NODE_SMOKE === '1';
const project = fileURLToPath(new URL('../', import.meta.url));
const runner = fileURLToPath(new URL('../scripts/run-node-framework.mjs', import.meta.url));
const secret = 'synthetic-node-http-test-key-at-least-32-bytes';
function safeFixtureDatabase(value: string | undefined) {
  assert(value, 'TEST_ACCOUNT_DATABASE_URL is required for opt-in account HTTP smoke.');
  const url = new URL(value);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname === '/teeko_node', 'Only loopback disposable teeko_node may be used.');
  return url;
}
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function stopProcess(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, 'exit'); child.kill('SIGTERM');
  if (await Promise.race([stopped, delay(3000, 'timeout', { ref: false })]) === 'timeout') { child.kill('SIGKILL'); await stopped; }
}
function sessionCookie(response: Response) {
  const value = response.headers.getSetCookie().find(value => value.startsWith('teeko_session='));
  assert(value && /; HttpOnly(?:;|$)/.test(value) && /; SameSite=Lax(?:;|$)/.test(value), 'Login did not issue a protected session cookie.');
  return value.split(';')[0];
}

test('actual Node production authenticates durable accounts, guards profile routes and closes development tools', { skip: !enabled, timeout: 45_000 }, async t => {
  const base = safeFixtureDatabase(database);
  await access(new URL('../.next-node/BUILD_ID', import.meta.url));
  const admin = new Pool({ connectionString: base.href });
  const schema = `node_fixture_${randomUUID().replaceAll('-', '')}`;
  base.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: base.href });
  let child: ChildProcess | undefined;
  t.after(async () => { await stopProcess(child); await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrateAccounts(base.href);
  let code = '';
  const service = new AccountService(pool, { secret, sendCode: async delivery => { code = delivery.code; } });
  const invite = (await service.issueInvitations({ count: 1, expiresAt: new Date(Date.now() + 3_600_000), issuedBy: 'node-http-fixture' }))[0];
  const flow = await service.verifyInvitation(invite.code);
  await service.sendCode('register', 'node-http@example.test', flow.flowToken);
  await service.verifyCode('register', code, flow.flowToken);
  await service.register(flow.flowToken, 'fixture-node-password', 'fixture-terms-v1');
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  async function start() {
    child = spawn(process.execPath, [runner, 'start'], { cwd: project, stdio: ['ignore', 'ignore', 'ignore'], env: {
      ...process.env, PORT: String(port), APP_ORIGIN: origin, AUTH_SECRET: secret, DATABASE_URL: base.href,
      RESEND_API_KEY: 'fixture-not-a-real-mail-key', RESEND_FROM: 'Teeko <hello@auth.teeko.app>', ACCOUNT_TERMS_VERSION: 'fixture-terms-v1',
      OPENAI_API_KEY: '', OPENAI_CHILD_DATA_READY: 'false', DASHSCOPE_API_KEY: '', VOLCENGINE_VOICE_API_KEY: '', ZHIPU_API_KEY: '',
    } });
    let startupError = false; child.on('error', () => { startupError = true; });
    for (let attempt = 0; attempt < 200; attempt++) {
      assert(!startupError && child.exitCode === null && child.signalCode === null, 'Node production exited before ready.');
      try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
      await delay(50);
    }
    assert.fail('Node account health never became ready.');
  }
  const request = (path: string, body?: unknown, cookie?: string, method = body === undefined ? 'GET' : 'POST', from = origin) => fetch(`${origin}${path}`, {
    method, redirect: 'manual', headers: { ...(body === undefined ? {} : { Origin: from, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
  });
  await start();
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/api/v1/auth/login', { email: 'node-http@example.test', password: 'fixture-node-password' }, undefined, 'POST', 'https://different.example')).status, 403);
  assert.equal((await request('/api/v1/auth/login', { email: 'node-http@example.test', password: 'wrong-fixture-password' })).status, 401);
  assert.equal((await request('/api/v1/profile')).status, 401);
  const absentOrigin = await fetch(`${origin}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(absentOrigin.status, 403);
  const forged = await fetch(`${origin}/api/v1/profile`, { headers: { 'oai-authenticated-user-id': 'forged-fixture-user', 'oai-authenticated-user-email': 'fixture@example.test' } });
  assert.equal(forged.status, 401);
  let login = await request('/api/v1/auth/login', { email: 'node-http@example.test', password: 'fixture-node-password' });
  assert.equal(login.status, 200); let cookie = sessionCookie(login);
  assert.deepEqual(await login.json(), { ok: true, next: '/onboarding' });
  assert.equal((await request('/onboarding', undefined, cookie)).status, 200);
  const guarded = await request('/courses', undefined, cookie);
  assert.equal(guarded.status, 307); assert.equal(guarded.headers.get('location'), '/onboarding');
  const profile = { name: 'Node fixture', ageRange: '10–11', level: 'unsure' };
  const saved = await request('/api/v1/profile', profile, cookie, 'PATCH');
  assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), { ok: true, profile });
  assert.equal((await request('/courses', undefined, cookie)).status, 200);
  assert.deepEqual(await (await request('/api/v1/courses', undefined, cookie)).json(), { ok: true, courses: [] });
  await stopProcess(child); await start();
  const state = await request('/api/v1/auth/state', undefined, cookie);
  assert.equal(state.status, 200);
  const persisted = await state.json() as { user: { email: string; profileComplete: boolean } };
  assert.equal(persisted.user.email, 'node-http@example.test'); assert.equal(persisted.user.profileComplete, true);
  login = await request('/api/v1/auth/login', { email: 'node-http@example.test', password: 'fixture-node-password' });
  assert.equal(login.status, 200); cookie = sessionCookie(login); assert.deepEqual(await login.json(), { ok: true, next: '/courses' });
  assert.equal((await request('/api/v1/auth/logout', {}, cookie)).status, 200);
  assert.equal((await request('/api/v1/profile', undefined, cookie)).status, 401);
  const privatePage = await request('/courses', undefined, cookie);
  assert.equal(privatePage.status, 307); assert.equal(privatePage.headers.get('location'), '/login');
  for (const path of ['/prototype', '/preview', '/legacy-classroom']) assert.equal((await request(path)).status, 404);
  await stopProcess(child);
  const released = createServer(); released.listen(port, '127.0.0.1'); await once(released, 'listening');
  await new Promise<void>((resolve, reject) => released.close(error => error ? reject(error) : resolve()));
  t.diagnostic(`Node account HTTP, server route guards, restart persistence and logout passed; port ${port} released and rebound. No email API invoked.`);
});
