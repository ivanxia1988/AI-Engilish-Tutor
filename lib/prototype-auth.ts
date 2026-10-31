export function prototypeEmailError(email: string): string | null {
  const value = email.trim();
  return value.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value)
    ? null : '请输入有效的邮箱地址。';
}

// Only validates the local walkthrough. Real email codes must be verified server-side.
export function prototypeLoginError({ email, code, consent, codeSentTo }: {
  email: string; code: string; consent: boolean; codeSentTo: string;
}): string | null {
  const emailError = prototypeEmailError(email);
  if (emailError) return emailError;
  if (!codeSentTo || email.trim().toLowerCase() !== codeSentTo.trim().toLowerCase()) return '请先获取邮箱验证码。';
  if (code !== '123456') return '验证码不正确，请重新输入。';
  if (!consent) return '请阅读并同意《用户协议》。';
  return null;
}

type AuthEntry = 'login' | 'register' | 'recover' | 'invite';
type CodePurpose = 'register' | 'recover';
type AuthStage = AuthEntry | 'set-password' | 'reset-password';
type Verification = { email: string; purpose: CodePurpose; expiresAt: number };
type DemoAccount = { digest: string; profileComplete: boolean };
type DemoInvitation = { expiresAt: number | null; disabled: boolean; redeemedBy: string | null };
export interface PrototypeAuth {
  stage: AuthStage;
  email: string;
  code: string;
  password: string;
  confirmation: string;
  consent: boolean;
  issued: Verification | null;
  verified: Verification | null;
  accounts: Record<string, DemoAccount>;
  authenticatedEmail: string | null;
  invite: string;
  invitation: { code: string; expiresAt: number } | null;
  invitations: Record<string, DemoInvitation>;
  error: string;
  message: string;
}
type AuthResult = { state: PrototypeAuth; destination?: 'profile' | 'home' };
const emailKey = (email: string) => email.trim().toLowerCase();

export function createPrototypeAuth(): PrototypeAuth {
  return { stage: 'login', email: '', code: '', password: '', confirmation: '', consent: false, issued: null, verified: null, accounts: {}, authenticatedEmail: null, invite: '', invitation: null, invitations: {
    'TEEKO-TRY': { expiresAt: null, disabled: false, redeemedBy: null },
    'TEEKO-NEXT': { expiresAt: null, disabled: false, redeemedBy: null },
    'TEEKO-EXPIRED': { expiresAt: 0, disabled: false, redeemedBy: null },
    'TEEKO-OFF': { expiresAt: null, disabled: true, redeemedBy: null },
  }, error: '', message: '' };
}

export function navigatePrototypeAuth(state: PrototypeAuth, stage: AuthEntry): PrototypeAuth {
  return { ...state, stage: stage === 'register' && !state.invitation ? 'invite' : stage, invitation: stage === 'register' ? state.invitation : null, code: '', password: '', confirmation: '', consent: false, issued: null, verified: null, authenticatedEmail: null, error: '', message: '' };
}

export function leavePrototypeAuth(state: PrototypeAuth): PrototypeAuth {
  return { ...navigatePrototypeAuth(state, 'login'), authenticatedEmail: state.authenticatedEmail };
}

export function changePrototypeAuth(state: PrototypeAuth, fields: Partial<Pick<PrototypeAuth, 'email' | 'code' | 'password' | 'confirmation' | 'consent' | 'invite'>>): PrototypeAuth {
  const changedEmail = fields.email !== undefined && emailKey(fields.email) !== emailKey(state.email);
  const changedInvite = fields.invite !== undefined && fields.invite !== state.invite;
  return { ...state, ...fields, ...(changedEmail ? { code: '', issued: null, verified: null } : {}), ...(changedInvite ? { invitation: null, issued: null, verified: null } : {}), error: '', message: '' };
}

function invitationCodeError(state: PrototypeAuth, code: string, now: number): string | null {
  if (!code) return '请输入邀请码。';
  const invitation = state.invitations[code];
  if (!Object.hasOwn(state.invitations, code)) return '邀请码不正确，请核对后再试。';
  if (invitation.disabled) return '这个邀请码已停用，请联系邀请人。';
  if (invitation.redeemedBy) return '这个邀请码已使用。已有账号可以直接登录。';
  if (invitation.expiresAt !== null && now >= invitation.expiresAt) return '这个邀请码已过期，请联系邀请人。';
  return null;
}

function invitationProofError(state: PrototypeAuth, now: number): string | null {
  if (!state.invitation) return '请先验证邀请码。';
  if (now >= state.invitation.expiresAt) return '邀请码验证已过期，请重新填写邀请码。';
  return invitationCodeError(state, state.invitation.code, now);
}

// Demo invitations and proofs are memory-only, not production access control.
export function verifyPrototypeInvitation(state: PrototypeAuth, value: string, now = Date.now()): PrototypeAuth {
  const code = value.trim().toUpperCase();
  const error = invitationCodeError(state, code, now);
  const base = navigatePrototypeAuth(state, 'invite');
  if (error) return { ...base, invite: value, error };
  const expiresAt = Math.min(now + 900_000, state.invitations[code].expiresAt ?? Infinity);
  return { ...base, invite: code, stage: 'register', invitation: { code, expiresAt } };
}

export function requestPrototypeCode(state: PrototypeAuth, now = Date.now()): PrototypeAuth {
  if (state.stage !== 'register' && state.stage !== 'recover') return state;
  if (state.stage === 'register') {
    const invitationError = invitationProofError(state, now);
    if (invitationError) return { ...state, issued: null, verified: null, error: invitationError };
  }
  const error = prototypeEmailError(state.email);
  if (error) return { ...state, error };
  const account = state.accounts[emailKey(state.email)];
  if (state.stage === 'register' && account) return { ...state, error: '该邮箱已注册，请用密码登录。' };
  if (state.stage === 'recover' && !account) return { ...state, error: '当前原型会话中没有该账号，请先注册。' };
  return { ...state, code: '123456', issued: { email: emailKey(state.email), purpose: state.stage, expiresAt: now + 300_000 }, verified: null, error: '', message: '' };
}

export function prototypePasswordError(password: string, confirmation: string): string | null {
  if (password.length < 8 || password.length > 64) return '密码需为 8–64 位。';
  if (password !== confirmation) return '两次输入的密码不一致。';
  return null;
}

// Memory-only walkthrough digest; real passwords need server-side password hashing and sessions.
async function demoDigest(password: string): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function submitPrototypeAuth(state: PrototypeAuth, now = Date.now()): Promise<AuthResult> {
  const fail = (error: string): AuthResult => ({ state: { ...state, error, message: '' } });
  if (state.stage === 'invite') return { state: verifyPrototypeInvitation(state, state.invite, now) };
  if (state.stage === 'register' || state.stage === 'set-password') {
    const invitationError = invitationProofError(state, now);
    if (invitationError) return fail(invitationError);
  }
  const error = prototypeEmailError(state.email);
  if (error) return fail(error);
  const key = emailKey(state.email), account = state.accounts[key];
  if (state.stage === 'login') {
    if (!state.password) return fail('请输入密码。');
    if (!account || await demoDigest(state.password) !== account.digest) return fail('邮箱或密码不正确，请重试。');
    return { state: { ...state, email: key, password: '', confirmation: '', authenticatedEmail: key, error: '', message: '' }, destination: account.profileComplete ? 'home' : 'profile' };
  }
  if (state.stage === 'register' || state.stage === 'recover') {
    if (!state.issued || state.issued.email !== key || state.issued.purpose !== state.stage) return fail('请先获取邮箱验证码。');
    if (now >= state.issued.expiresAt) return fail('验证码已过期，请重新获取。');
    if (state.code !== '123456') return fail('验证码不正确，请重新输入。');
    if (state.stage === 'register' && !state.consent) return fail('请阅读并同意《用户协议》。');
    if (state.stage === 'register' && account) return fail('该邮箱已注册，请用密码登录。');
    if (state.stage === 'recover' && !account) return fail('当前原型会话中没有该账号，请先注册。');
    return { state: { ...state, stage: state.stage === 'register' ? 'set-password' : 'reset-password', verified: state.issued, issued: null, code: '', password: '', confirmation: '', error: '' } };
  }
  const purpose = state.stage === 'set-password' ? 'register' : 'recover';
  if (!state.verified || state.verified.email !== key || state.verified.purpose !== purpose) return fail('请先完成邮箱验证。');
  if (now >= state.verified.expiresAt) return fail('邮箱验证已过期，请返回重新获取验证码。');
  if (purpose === 'register' && !state.consent) return fail('请阅读并同意《用户协议》。');
  if (purpose === 'recover' && !account) return fail('当前原型会话中没有该账号，请先注册。');
  if (purpose === 'register' && account) return fail('该邮箱已注册，请用密码登录。');
  const passwordError = prototypePasswordError(state.password, state.confirmation);
  if (passwordError) return fail(passwordError);
  const digest = await demoDigest(state.password);
  const accounts = { ...state.accounts, [key]: { digest, profileComplete: account?.profileComplete ?? false } };
  const saved = { ...state, accounts, email: key, password: '', confirmation: '', code: '', verified: null, issued: null, error: '' };
  if (purpose === 'recover') return { state: { ...navigatePrototypeAuth(saved, 'login'), message: '密码已重置，请用新密码登录。' } };
  const inviteCode = state.invitation!.code;
  return { state: { ...saved, stage: 'login', authenticatedEmail: key, consent: false, invitation: null, invite: '', invitations: { ...state.invitations, [inviteCode]: { ...state.invitations[inviteCode], redeemedBy: key } } }, destination: 'profile' };
}

export function markPrototypeProfileComplete(state: PrototypeAuth): PrototypeAuth {
  const key = state.authenticatedEmail;
  if (!key || !state.accounts[key]) return state;
  return { ...state, accounts: { ...state.accounts, [key]: { ...state.accounts[key], profileComplete: true } } };
}
