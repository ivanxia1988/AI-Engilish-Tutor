import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgreementNotice } from '../components/product/agreement-notice.tsx';
import { ACCOUNT_TERMS_VERSION } from '../lib/account-terms.ts';
import { handleAccountRequest } from '../lib/server/account-runtime.ts';
import { withRuntimeEnv } from '../lib/server/runtime-env.ts';

test('the agreement actually displays versioned trial terms rather than a pending placeholder', () => {
  const page = renderToStaticMarkup(createElement(AgreementNotice, { onClose() {} }));
  assert.match(page, new RegExp(ACCOUNT_TERMS_VERSION));
  assert.match(page, /邀请码/); assert.match(page, /邮箱/); assert.match(page, /Resend/);
  assert.doesNotMatch(page, /将在账号服务开放前公布|不会提交同意记录/);
});

test('registration stays closed when the approved agreement version does not match the displayed text', async () => {
  const response = await withRuntimeEnv({ APP_ORIGIN: 'https://teeko.app', ACCOUNT_TERMS_VERSION: 'obsolete-terms' }, () => handleAccountRequest(new Request('https://teeko.app/api/v1/auth/register', { method: 'POST', headers: { Origin: 'https://teeko.app', 'Content-Type': 'application/json' }, body: '{}' })));
  assert.equal(response.status, 503);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, 'REGISTRATION_UNAVAILABLE');
});
