import { readRuntimeEnv } from './runtime-env';
import { getAccountPool } from '../../db/postgres';
import { AccountError, AccountService } from './account-service';
import { accountCookie, accountResponse, createAccountHandler } from './account-http';
import { sendAccountCode } from './account-mail';

export function accountOrigin(): string {
  const configured = readRuntimeEnv('APP_ORIGIN');
  if (!configured) throw new Error('应用地址尚未配置。');
  const parsed = new URL(configured);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.username || parsed.password || configured !== parsed.origin || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local))) throw new Error('应用地址配置无效。');
  return parsed.origin;
}
export function getAccountService(): AccountService {
  const secret = readRuntimeEnv('AUTH_SECRET') ?? '';
  const pool = getAccountPool(readRuntimeEnv('DATABASE_URL'));
  return new AccountService(pool, {
    secret,
    sendCode: async message => {
      try { await sendAccountCode({ key: readRuntimeEnv('RESEND_API_KEY') ?? '', from: readRuntimeEnv('RESEND_FROM') ?? '' }, message); }
      catch { throw new AccountError('MAIL_UNAVAILABLE', '验证码邮件暂时无法发送，请稍后重试。', 503); }
    },
  });
}
export async function handleAccountRequest(request: Request): Promise<Response> {
  try {
    const origin = accountOrigin();
    const termsVersion = readRuntimeEnv('ACCOUNT_TERMS_VERSION') ?? '';
    if (new URL(request.url).pathname === '/api/v1/auth/register' && !termsVersion) return accountResponse({ ok: false, error: { code: 'REGISTRATION_UNAVAILABLE', message: '注册服务尚未开放，请稍后再试。' } }, 503);
    const handler = createAccountHandler({ service: getAccountService(), origin, termsVersion,
      accountError: error => error instanceof AccountError ? { code: error.code, status: error.status, message: error.message } : null,
    });
    return await handler(request);
  } catch { return accountResponse({ ok: false, error: { code: 'UNAVAILABLE', message: '账号服务暂时不可用，请稍后再试。' } }, 503); }
}
export async function accountFromRequest(request: Request) {
  return getAccountService().session(accountCookie(request, 'teeko_session'));
}
