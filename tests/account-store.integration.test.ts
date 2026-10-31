import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { hashPassword } from '../lib/server/auth-crypto.ts';
import { Pool } from 'pg';
import { AccountService, AccountError, type CodeDelivery } from '../lib/server/account-service.ts';

const database = process.env.TEST_DATABASE_URL;
if (database && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(database).hostname)) throw new Error('Only loopback disposable PostgreSQL is allowed in this test.');

async function fixture(t: TestContext) {
  const admin = new Pool({ connectionString: database });
  const schema = `account_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: database, options: `-c search_path=${schema},public`, max: 8 });
  await pool.query(await readFile(new URL('../db/migrations/0001_accounts.sql', import.meta.url), 'utf8'));
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  const deliveries: CodeDelivery[] = [];
  let clock = new Date('2026-10-31T00:00:00Z');
  let failMail = false;
  const options = { secret: 'synthetic-test-protection-key-over-32-bytes', now: () => new Date(clock), sendCode: async (delivery: CodeDelivery) => { deliveries.push(delivery); if (failMail) throw new Error('synthetic mail transport error'); } };
  const service = new AccountService(pool, options);
  const invite = async () => (await service.issueInvitations({ count: 1, expiresAt: new Date(clock.getTime() + 3_600_000), issuedBy: 'test' }))[0];
  const proof = async (code: string, email: string) => {
    const flow = await service.verifyInvitation(code);
    await service.sendCode('register', email, flow.flowToken);
    await service.verifyCode('register', deliveries.at(-1)!.code, flow.flowToken);
    return flow.flowToken;
  };
  return { pool, service, options, deliveries, invite, proof, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); }, failMail: () => { failMail = true; } };
}
const rejectsCode = (promise: Promise<unknown>, code: string) => assert.rejects(promise, error => error instanceof AccountError && error.code === code);

test('PostgreSQL account lifecycle and transactional invitation invariants', { skip: !database, timeout: 30_000 }, async t => {
  await t.test('invitation validation does not consume; final registration creates one account and durable session', async t => {
    const f = await fixture(t); const invitation = await f.invite();
    const flow = await f.service.verifyInvitation(invitation.code);
    assert.equal((await f.service.listInvitations())[0].redeemedAt, null);
    assert.equal(await f.service.session(flow.flowToken), null);
    await rejectsCode(f.service.register(flow.flowToken, 'fixture-pass-123', 'test-v1'), 'FLOW_INVALID');
    await f.service.sendCode('register', 'ONE@example.test', flow.flowToken);
    const email = f.deliveries.at(-1)!;
    assert.equal(email.email, 'one@example.test');
    await f.service.verifyCode('register', email.code, flow.flowToken);
    assert.equal(await f.service.session(flow.flowToken), null);
    const created = await f.service.register(flow.flowToken, 'fixture-pass-123', 'test-v1');
    assert.equal(created.user.profileComplete, false);
    const restarted = new AccountService(f.pool, f.options);
    assert.equal((await restarted.session(created.sessionToken))?.id, created.user.id);
    assert.equal((await f.service.listInvitations())[0].redeemedBy, created.user.id);
    assert.equal(await f.service.flow(flow.flowToken), null);
    const stored = (await f.pool.query('SELECT token_hash FROM teeko_sessions')).rows[0];
    assert.notEqual(stored.token_hash, created.sessionToken);
    await rejectsCode(f.service.verifyInvitation(invitation.code), 'INVITATION_USED');
    await rejectsCode(f.service.register(flow.flowToken, 'fixture-pass-123', 'test-v1'), 'FLOW_INVALID');
  });

  await t.test('two independently verified emails racing one invitation activate exactly one account', async t => {
    const f = await fixture(t); const invitation = await f.invite();
    const one = await f.proof(invitation.code, 'one@example.test');
    const two = await f.proof(invitation.code, 'two@example.test');
    const results = await Promise.allSettled([f.service.register(one, 'fixture-pass-123', 'v1'), f.service.register(two, 'fixture-pass-123', 'v1')]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM teeko_accounts')).rows[0].count), 1);
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM teeko_sessions')).rows[0].count), 1);
  });

  await t.test('disabled or expired invitation is rechecked at final commit and leaves no partial account', async t => {
    const f = await fixture(t); const invitation = await f.invite();
    const flow = await f.proof(invitation.code, 'one@example.test');
    await f.service.disableInvitation(invitation.id);
    await rejectsCode(f.service.register(flow, 'fixture-pass-123', 'v1'), 'INVITATION_DISABLED');
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM teeko_accounts')).rows[0].count), 0);
    const expired = await f.invite(); const proof = await f.proof(expired.code, 'two@example.test');
    await f.pool.query('UPDATE teeko_invitations SET expires_at=$1 WHERE id=$2', [f.options.now(), expired.id]);
    await rejectsCode(f.service.register(proof, 'fixture-pass-123', 'v1'), 'INVITATION_EXPIRED');
  });

  await t.test('failed attempts survive transactions, are capped, and cannot cross purposes', async t => {
    const f = await fixture(t); const invitation = await f.invite(); const flow = await f.service.verifyInvitation(invitation.code);
    await f.service.sendCode('register', 'one@example.test', flow.flowToken);
    const correct = f.deliveries.at(-1)!.code;
    await rejectsCode(f.service.verifyCode('reset', correct, flow.flowToken), 'FLOW_INVALID');
    const wrong = correct === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) await rejectsCode(f.service.verifyCode('register', wrong, flow.flowToken), 'CODE_INVALID');
    await rejectsCode(f.service.verifyCode('register', correct, flow.flowToken), 'CODE_LOCKED');
    assert.equal((await f.pool.query('SELECT attempts FROM teeko_account_flows')).rows[0].attempts, 5);
  });

  await t.test('delivery failures leave no usable code and never make a password proof', async t => {
    const f = await fixture(t); const invitation = await f.invite(); const flow = await f.service.verifyInvitation(invitation.code);
    f.failMail();
    await rejectsCode(f.service.sendCode('register', 'one@example.test', flow.flowToken), 'MAIL_UNAVAILABLE');
    await rejectsCode(f.service.verifyCode('register', f.deliveries.at(-1)!.code, flow.flowToken), 'CODE_INVALID');
    assert.notEqual((await f.service.flow(flow.flowToken))?.stage, 'password');
  });

  await t.test('expired codes and proofs, resend cooldown, cancellation and persistent limits fail closed', async t => {
    const f = await fixture(t); const invitation = await f.invite(); const flow = await f.service.verifyInvitation(invitation.code);
    await f.service.sendCode('register', 'one@example.test', flow.flowToken);
    await rejectsCode(f.service.sendCode('register', 'one@example.test', flow.flowToken), 'RATE_LIMITED');
    f.advance(5 * 60_000 + 1);
    await rejectsCode(f.service.verifyCode('register', f.deliveries.at(-1)!.code, flow.flowToken), 'CODE_INVALID');
    await f.service.sendCode('register', 'one@example.test', flow.flowToken);
    await f.service.verifyCode('register', f.deliveries.at(-1)!.code, flow.flowToken);
    f.advance(10 * 60_000 + 1);
    await rejectsCode(f.service.register(flow.flowToken, 'fixture-pass-123', 'v1'), 'FLOW_INVALID');
    const other = await f.service.verifyInvitation(invitation.code); await f.service.cancelFlow(other.flowToken);
    assert.equal(await f.service.flow(other.flowToken), null);
    await f.service.limit('durable-test', 1, 60);
    const restarted = new AccountService(f.pool, f.options);
    await rejectsCode(restarted.limit('durable-test', 1, 60), 'RATE_LIMITED');
  });

  await t.test('reset changes password, revokes all sessions and cannot be reused', async t => {
    const f = await fixture(t); const invitation = await f.invite(); const proof = await f.proof(invitation.code, 'one@example.test');
    const created = await f.service.register(proof, 'fixture-pass-123', 'v1');
    const old = await f.service.login('one@example.test', 'fixture-pass-123');
    const reset = await f.service.sendCode('reset', 'one@example.test');
    await f.service.verifyCode('reset', f.deliveries.at(-1)!.code, reset.flowToken);
    await f.service.reset(reset.flowToken, 'new-fixture-pass');
    assert.equal(await f.service.session(created.sessionToken), null);
    assert.equal(await f.service.session(old.sessionToken), null);
    await rejectsCode(f.service.login('one@example.test', 'fixture-pass-123'), 'LOGIN_INVALID');
    assert((await f.service.login('one@example.test', 'new-fixture-pass')).sessionToken);
    await rejectsCode(f.service.reset(reset.flowToken, 'third-fixture-pass'), 'FLOW_INVALID');
    assert.equal(Number((await f.pool.query('SELECT auth_version FROM teeko_accounts')).rows[0].auth_version), 1);
  });

  await t.test('a session insertion failure rolls back account, invitation and proof together', async t => {
    const f = await fixture(t); const invitation = await f.invite(); const proof = await f.proof(invitation.code, 'rollback@example.test');
    await f.pool.query("CREATE FUNCTION reject_session_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic transaction fault'; END; $$");
    await f.pool.query('CREATE TRIGGER session_fixture BEFORE INSERT ON teeko_sessions FOR EACH ROW EXECUTE FUNCTION reject_session_fixture()');
    await assert.rejects(f.service.register(proof, 'fixture-pass-123', 'v1'));
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM teeko_accounts')).rows[0].count), 0);
    assert.equal((await f.service.listInvitations())[0].redeemedAt, null);
    assert.equal((await f.service.flow(proof))?.stage, 'password');
    await f.pool.query('DROP TRIGGER session_fixture ON teeko_sessions');
    assert((await f.service.register(proof, 'fixture-pass-123', 'v1')).sessionToken);
  });

  await t.test('reset invalidates every previously issued reset proof for that email', async t => {
    const f = await fixture(t);
    await f.service.register(await f.proof((await f.invite()).code, 'one@example.test'), 'fixture-pass-123', 'v1');
    const first = await f.service.sendCode('reset', 'one@example.test');
    await f.service.verifyCode('reset', f.deliveries.at(-1)!.code, first.flowToken);
    const other = await f.service.sendCode('reset', 'one@example.test');
    await f.service.verifyCode('reset', f.deliveries.at(-1)!.code, other.flowToken);
    await f.service.reset(first.flowToken, 'new-fixture-pass');
    await rejectsCode(f.service.reset(other.flowToken, 'stale-fixture-pass'), 'FLOW_INVALID');
    assert((await f.service.login('one@example.test', 'new-fixture-pass')).sessionToken);
  });

  await t.test('login cannot issue an old-version session after the password changes under its row lock', async t => {
    const f = await fixture(t);
    const user = await f.service.register(await f.proof((await f.invite()).code, 'one@example.test'), 'fixture-pass-123', 'v1');
    const blocker = await f.pool.connect();
    try {
      await blocker.query('BEGIN');
      const pid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await blocker.query('SELECT id FROM teeko_accounts WHERE id=$1 FOR UPDATE', [user.user.id]);
      const login = f.service.login('one@example.test', 'fixture-pass-123');
      let blocked = false;
      for (let attempt = 0; attempt < 300; attempt++) {
        blocked = (await f.pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked', [pid])).rows[0].blocked;
        if (blocked) break;
        await delay(10);
      }
      assert(blocked, 'login never reached the account lock');
      await blocker.query('UPDATE teeko_accounts SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2', [await hashPassword('new-fixture-pass'), user.user.id]);
      await blocker.query('DELETE FROM teeko_sessions WHERE account_id=$1', [user.user.id]);
      await blocker.query('COMMIT');
      await rejectsCode(login, 'LOGIN_INVALID');
      assert.equal(Number((await f.pool.query('SELECT count(*) FROM teeko_sessions')).rows[0].count), 0);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });

  await t.test('profiles and logout belong to the authenticated account, session expiry persists', async t => {
    const f = await fixture(t);
    const a = await f.service.register(await f.proof((await f.invite()).code, 'one@example.test'), 'fixture-pass-123', 'v1');
    const b = await f.service.register(await f.proof((await f.invite()).code, 'two@example.test'), 'fixture-pass-123', 'v1');
    const profile = { name: 'Leo', ageRange: '10–11' as const, level: 'unsure' as const };
    assert.deepEqual(await f.service.saveProfile(a.user.id, profile), profile);
    assert.equal((await f.service.session(a.sessionToken))?.profileComplete, true);
    assert.equal(await f.service.getProfile(b.user.id), null);
    await f.service.logout(a.sessionToken); assert.equal(await f.service.session(a.sessionToken), null);
    assert.equal((await f.service.session(b.sessionToken))?.id, b.user.id);
    f.advance(7 * 24 * 3_600_000 + 1); assert.equal(await f.service.session(b.sessionToken), null);
  });
});
