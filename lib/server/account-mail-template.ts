type AccountCodeMessage = { purpose: 'register' | 'reset'; code: string };

function escapeHtml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, character => entities[character]);
}

export function renderAccountCodeMail(message: AccountCodeMessage): { subject: string; text: string; html: string } {
  const registering = message.purpose === 'register';
  const subject = registering ? 'Teeko · 注册邮箱验证码' : 'Teeko · 重置密码验证码';
  const title = registering ? '验证你的邮箱' : '重置你的 Teeko 密码';
  const introduction = registering
    ? '我们收到了你的 Teeko 注册申请。请在注册页面输入下方验证码，验证邮箱后继续设置密码。'
    : '我们收到了你的密码重置申请。请在重置密码页面输入下方验证码，验证通过后设置新密码。';
  const expiry = '验证码在 5 分钟内有效，仅用于本次操作。';
  const safety = '请勿向任何人提供或转发此验证码。';
  const unsolicited = registering
    ? '如果这不是你本人发起的操作，请忽略此邮件，无需进行任何操作。'
    : '如果这不是你本人发起的操作，请忽略此邮件，你的密码不会因此改变。';
  const footer = '此邮件由 Teeko 系统自动发送，请勿直接回复。';
  const text = ['Teeko', title, '你好，', introduction, `验证码：${message.code}`, expiry, safety, unsolicited, footer, '访问 Teeko：https://teeko.app/'].join('\n\n');
  const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#f7f3eb;color:#1f2b49;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${title}，验证码在 5 分钟内有效。</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background-color:#f7f3eb;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;border-collapse:separate;">
        <tr><td style="padding:0 8px 20px;">
          <a href="https://teeko.app/" style="color:#1f2b49;text-decoration:none;font-size:30px;font-weight:800;letter-spacing:-1px;">Tee<span style="color:#e98236;">ko</span></a>
        </td></tr>
        <tr><td style="padding:32px 24px;background-color:#ffffff;border:1px solid #e9dece;border-top:4px solid #e98236;border-radius:12px;">
          <p style="margin:0 0 12px;color:#167569;font-size:12px;font-weight:700;letter-spacing:2px;">账号验证</p>
          <h1 style="margin:0 0 24px;color:#1f2b49;font-size:26px;line-height:1.4;font-weight:700;">${title}</h1>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.8;">你好，</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.8;">${introduction}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;background-color:#f7f3eb;border:1px solid #e9dece;border-radius:8px;">
            <tr><td align="center" style="padding:20px 16px;">
              <p style="margin:0 0 8px;color:#5f6980;font-size:12px;">你的验证码</p>
              <p style="margin:0;color:#1f2b49;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:36px;line-height:1.3;font-weight:700;letter-spacing:8px;">${escapeHtml(message.code)}</p>
            </td></tr>
          </table>
          <p style="margin:16px 0 8px;color:#5f6980;font-size:13px;line-height:1.8;">${expiry}</p>
          <p style="margin:0 0 24px;color:#5f6980;font-size:13px;line-height:1.8;">${safety}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:1px solid #eee6d9;">
            <tr><td style="padding-top:20px;color:#5f6980;font-size:13px;line-height:1.8;">${unsolicited}</td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:24px 16px 0;color:#6b7385;font-size:12px;line-height:1.8;">
          <p style="margin:0 0 8px;">${footer}</p>
          <a href="https://teeko.app/" style="color:#167569;text-decoration:underline;">访问 Teeko</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}
