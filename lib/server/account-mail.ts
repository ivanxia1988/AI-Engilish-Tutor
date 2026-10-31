import { renderAccountCodeMail } from './account-mail-template';

type MailConfig = { key: string; from: string };
type CodeMessage = { email: string; code: string; purpose: 'register' | 'reset'; idempotencyKey: string };
export async function sendAccountCode(config: MailConfig, message: CodeMessage, transport: typeof fetch = fetch): Promise<void> {
  if (!config.key || !config.from || /[\r\n]/.test(config.from) || !/@[^<>\s]+\.[^<>\s]+>?$/.test(config.from)) throw new Error('邮件服务尚未配置。');
  const content = renderAccountCodeMail(message);
  let response: Response;
  try {
    response = await transport('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey },
      body: JSON.stringify({ from: config.from, to: [message.email], ...content }),
    });
  } catch { throw new Error('验证码邮件发送失败，请稍后重试。'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error('验证码邮件发送失败，请稍后重试。'); }
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string' || !body.id) throw new Error();
  } catch { throw new Error('验证码邮件发送结果未确认，请稍后重试。'); }
}
