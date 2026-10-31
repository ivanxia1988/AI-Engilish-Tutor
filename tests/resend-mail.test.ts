import test from 'node:test';
import assert from 'node:assert/strict';
import { sendAccountCode } from '../lib/server/account-mail.ts';

test('Resend sends an explicit purpose with idempotency and never puts secret input into errors', async () => {
  let calls = 0;
  const config = { key: 'fixture-mail-key', from: 'Teeko <hello@teeko.app>' };
  const message = { email: 'fixture@example.test', code: '123456', purpose: 'register' as const, idempotencyKey: 'fixture-message' };
  await sendAccountCode(config, message, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'fixture-message');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.from, config.from); assert.deepEqual(body.to, [message.email]);
    assert.match(body.text, /123456/); assert.match(body.subject, /注册/);
    return Response.json({ id: 'provider-id' });
  });
  assert.equal(calls, 1);
  await assert.rejects(sendAccountCode(config, message, async () => Response.json({ error: message.code + config.key }, { status: 403 })), error => {
    assert.doesNotMatch(String(error), /123456|fixture-mail-key/); return true;
  });
});

test('missing provider acceptance and malformed sender both fail without claiming an email was sent', async () => {
  const message = { email: 'fixture@example.test', code: '654321', purpose: 'reset' as const, idempotencyKey: 'fixture-reset' };
  await assert.rejects(sendAccountCode({ key: 'fixture', from: 'Teeko <hello@teeko.app>' }, message, async () => Response.json({})));
  let called = false;
  await assert.rejects(sendAccountCode({ key: '', from: '' }, message, async () => { called = true; return Response.json({ id: 'id' }); }));
  assert.equal(called, false);
});
