import { z } from 'zod';

export type AccountIntent = 'login' | 'register' | 'recover';
export function accountIntent(value: string | undefined): AccountIntent { return value === 'register' || value === 'recover' ? value : 'login'; }
export function invitationSubmissionError(code: string): string { return code.trim() ? '' : '请输入邀请码。'; }
export function accountSubmissionError(intent: AccountIntent, fields: { email: string; password: string; invitation: string }): string {
  if (intent === 'register') return invitationSubmissionError(fields.invitation);
  if (!z.string().trim().email().safeParse(fields.email).success) return '请输入有效的邮箱地址。';
  if (intent === 'login' && !fields.password) return '请输入密码。';
  return '';
}
export function passwordSubmissionError(password: string, confirmation: string) {
  if (password.length < 8 || password.length > 64) return '密码需要为 8–64 个字符。';
  return password === confirmation ? '' : '两次输入的密码不一致。';
}
