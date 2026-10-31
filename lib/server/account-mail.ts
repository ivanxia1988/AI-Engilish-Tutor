type MailConfig = { key: string; from: string };
type CodeMessage = { email: string; code: string; purpose: 'register' | 'reset'; idempotencyKey: string };
export async function sendAccountCode(config: MailConfig, message: CodeMessage, transport: typeof fetch = fetch): Promise<void> {
  if (!config.key || !config.from || /[\r\n]/.test(config.from) || !/@[^<>\s]+\.[^<>\s]+>?$/.test(config.from)) throw new Error('邮件服务尚未配置。');
  const action = message.purpose === 'register' ? '注册' : '重置密码';
  let response: Response;
  try {
    response = await transport('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey },
      body: JSON.stringify({ from: config.from, to: [message.email], subject: `Teeko ${action}验证码`, text: `你正在${action}。验证码：${message.code}\n\n验证码5分钟内有效，请勿告诉他人。\n如果不是你本人操作，请忽略这封邮件。` }),
    });
  } catch { throw new Error('验证码邮件发送失败，请稍后重试。'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error('验证码邮件发送失败，请稍后重试。'); }
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string' || !body.id) throw new Error();
  } catch { throw new Error('验证码邮件发送结果未确认，请稍后重试。'); }
}
