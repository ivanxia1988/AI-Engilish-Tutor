import { z } from 'zod';

export type AccountIntent = 'login' | 'register' | 'recover';
export const ACCOUNT_UNAVAILABLE = '账号服务尚未开放，请稍后再试。';

export function accountIntent(value: string | undefined): AccountIntent {
  return value === 'register' || value === 'recover' ? value : 'login';
}

export function invitationSubmissionError(code: string): string {
  return code.trim() ? ACCOUNT_UNAVAILABLE : '请输入邀请码。';
}

export function accountSubmissionError(intent: AccountIntent, fields: { email: string; password: string; invitation: string }): string {
  if (intent === 'register') return invitationSubmissionError(fields.invitation);
  if (!z.string().trim().email().safeParse(fields.email).success) return '请输入有效的邮箱地址。';
  if (intent === 'login' && !fields.password) return '请输入密码。';
  return ACCOUNT_UNAVAILABLE;
}
