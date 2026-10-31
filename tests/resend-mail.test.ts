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

async function captureEmail(purpose: 'register' | 'reset', code = '000000') {
  let body: Record<string, string> = {};
  await sendAccountCode(
    { key: 'fixture-mail-key', from: 'Teeko <hello@auth.teeko.app>' },
    { email: 'fixture@example.test', code, purpose, idempotencyKey: `fixture-${purpose}` },
    async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ id: 'provider-id' });
    },
  );
  return body;
}

for (const purpose of ['register', 'reset'] as const) {
  test(`the ${purpose} email includes a complete branded HTML and plain-text template`, async () => {
    const body = await captureEmail(purpose);
    assert.equal(typeof body.html, 'string');
    for (const content of [body.html, body.text]) {
      assert.match(content, /Teeko/);
      assert.match(content, /000000/);
      assert.match(content, /5\s*分钟/);
      assert.match(content, /请勿.*(?:分享|提供|转发)/);
      assert.match(content, /不是你本人.*忽略/);
      assert.match(content, /系统自动发送.*请勿.*回复/);
    }
    if (purpose === 'register') {
      assert.match(body.subject, /注册/);
      assert.match(body.text, /验证邮箱后.*设置密码/);
      assert.doesNotMatch(body.text, /重置密码申请/);
    } else {
      assert.match(body.subject, /重置密码/);
      assert.match(body.text, /密码重置申请/);
      assert.match(body.text, /密码不会因此改变/);
    }
    assert.match(body.html, /lang="zh-CN"/);
    assert.match(body.html, /https:\/\/teeko\.app\//);
    assert.doesNotMatch(body.html, /<img\b|<script\b|@import|@font-face|<link\b|<iframe\b/i);
    assert.doesNotMatch(body.html, /fixture@example\.test/);
  });
}

test('dynamic values are escaped in HTML and remain literal in the plain-text alternative', async () => {
  const code = '<a href="https://invalid.example/">&\'</a>';
  const body = await captureEmail('register', code);
  assert.equal(typeof body.html, 'string');
  assert.match(body.html, /&lt;a href=&quot;https:\/\/invalid\.example\/&quot;&gt;&amp;&#39;&lt;\/a&gt;/);
  assert.doesNotMatch(body.html, /<a href="https:\/\/invalid\.example/);
  assert.ok(body.text.includes(code));
});
