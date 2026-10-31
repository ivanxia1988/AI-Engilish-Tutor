'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { accountSubmissionError, passwordSubmissionError, type AccountIntent } from './account-state';
import { accountRequest, accountState, completed, destination, errorMessage, navigateProduct, sentCode, verifiedCode, type ProductDestination } from './account-request';
import { AgreementNotice } from './agreement-notice';

type Stage = 'invite' | 'email' | 'code' | 'password';
export function AccountForm({ intent, navigate = navigateProduct }: { intent: AccountIntent; navigate?: (path: ProductDestination) => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [invitation, setInvitation] = useState(''), [code, setCode] = useState('');
  const [visible, setVisible] = useState(false), [error, setError] = useState(''), [agreement, setAgreement] = useState(false), [agreed, setAgreed] = useState(false);
  const [stage, setStage] = useState<Stage>(intent === 'register' ? 'invite' : 'email');
  const [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false), [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false), [cooldown, setCooldown] = useState(0);
  const mounted = useRef(false), locked = useRef(false);
  const register = intent === 'register', recover = intent === 'recover', purpose = register ? 'register' : 'reset';
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    accountRequest('/auth/state', accountState, { signal: controller.signal }).then(state => {
      if (controller.signal.aborted) return;
      if (state.user && !recover) { navigate(state.user.profileComplete ? '/courses' : '/onboarding'); return; }
      if (state.flow?.purpose === purpose && intent !== 'login') { setStage(state.flow.stage); setEmail(state.flow.email ?? ''); }
      setLoading(false); setLoadFailed(false); setError('');
    }).catch(failure => {
      if (controller.signal.aborted) return;
      setError(errorMessage(failure)); setLoading(false); setLoadFailed(true);
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [attempt, intent, navigate, purpose, recover]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  async function perform(action: () => Promise<void>) {
    if (locked.current || loading || loadFailed) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); } catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function cancel() {
    await accountRequest('/auth/cancel', completed, { body: {} });
    setPassword(''); setConfirmation(''); setCode(''); setInvitation(''); setAgreed(false); setCooldown(0); setEmail('');
  }
  function changeEmail() { void perform(async () => { await cancel(); setStage(register ? 'invite' : 'email'); }); }
  function follow(event: MouseEvent<HTMLAnchorElement>, path: ProductDestination) {
    if (loading || locked.current) { event.preventDefault(); return; }
    if (loadFailed) return;
    event.preventDefault();
    void perform(async () => { await cancel(); navigate(path); });
  }
  async function send() {
    const validation = accountSubmissionError('recover', { email, password, invitation });
    if (validation) { setError(validation); return; }
    const result = await accountRequest('/auth/code', sentCode, { body: { purpose, email: email.trim() } });
    if (!mounted.current) return;
    setStage('code'); setCode(''); setCooldown(result.retryAfter);
  }
  async function submit() {
    if (intent === 'login') {
      const validation = accountSubmissionError('login', { email, password, invitation });
      if (validation) { setError(validation); return; }
      const result = await accountRequest('/auth/login', destination, { body: { email: email.trim(), password } });
      if (mounted.current) { setPassword(''); navigate(result.next); } return;
    }
    if (stage === 'invite') {
      const validation = accountSubmissionError('register', { email, password, invitation });
      if (validation) { setError(validation); return; }
      await accountRequest('/invitations/verify', destination, { body: { code: invitation.trim() } });
      if (mounted.current) { setInvitation(''); setStage('email'); } return;
    }
    if (stage === 'email') { await send(); return; }
    if (stage === 'code') {
      if (!/^\d{6}$/.test(code)) { setError('请输入 6 位验证码。'); return; }
      await accountRequest('/auth/verify', verifiedCode, { body: { purpose, code } });
      if (mounted.current) { setCode(''); setCooldown(0); setStage('password'); } return;
    }
    const validation = passwordSubmissionError(password, confirmation);
    if (validation) { setError(validation); return; }
    if (register && !agreed) { setError('请阅读并同意《用户协议》。'); return; }
    const result = await accountRequest(register ? '/auth/register' : '/auth/reset', destination, { body: { password, confirmation, ...(register ? { agreed: true } : {}) } });
    if (mounted.current) { setPassword(''); setConfirmation(''); navigate(result.next); }
  }
  const label = intent === 'login' ? '登录' : stage === 'invite' ? '验证并继续' : stage === 'email' ? '发送验证码' : stage === 'code' ? '验证邮箱' : register ? '完成注册' : '保存新密码';
  return <div className="tk-product tk-account">
    <section className="tk-account-story">
      <Link href="/" className="tk-wordmark" aria-label="Teeko 首页" onClick={event => follow(event, '/')}>Tee<span>ko</span><img src="/prototype-assets/teeko-head-icon.svg" alt="" /></Link>
      <div><span className="tk-age">8–13 岁 · 英语口语</span><h1>让孩子<br />自在地开口。</h1><p>一位有耐心的老师，<br />一页熟悉的课本，一次小小的进步。</p></div>
      <img className="tk-account-bird" src="/prototype-assets/pose-handoff.svg" alt="Teeko 小麻雀老师" />
    </section>
    <section className="tk-account-main"><form noValidate onSubmit={event => { event.preventDefault(); void perform(submit); }} aria-labelledby="tk-account-title">
      <h2 id="tk-account-title">{intent === 'login' ? '欢迎来到 Teeko' : stage === 'invite' ? '填写邀请码' : stage === 'password' ? register ? '设置密码' : '设置新密码' : recover ? '找回密码' : '验证邮箱'}</h2>
      {loading && <p role="status">正在检查账号…</p>}
      {error && <p id="tk-account-error" className="tk-account-error" role="alert">{error}</p>}
      {loadFailed && <button type="button" className="tk-submit" onClick={() => { setLoading(true); setLoadFailed(false); setAttempt(value => value + 1); }}>重新连接</button>}
      <fieldset disabled={busy || loading || loadFailed} className="tk-account-fields">
        {register && stage === 'invite' ? <label htmlFor="tk-invitation">邀请码<input id="tk-invitation" name="invitation" value={invitation} onChange={event => { setInvitation(event.target.value); setError(''); }} maxLength={100} placeholder="输入你收到的邀请码" autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby={error ? 'tk-account-error' : undefined} /></label> : intent === 'login' || stage === 'email' ? <label htmlFor="tk-email">邮箱<input id="tk-email" type="email" name="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setError(''); }} maxLength={254} placeholder="输入邮箱地址" aria-describedby={error ? 'tk-account-error' : undefined} /></label> : <div className="tk-verified-email"><span>{email}</span><button type="button" onClick={changeEmail}>更换邮箱</button></div>}
        {stage === 'code' && intent !== 'login' && <><label htmlFor="tk-code">验证码<input id="tk-code" name="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => { setCode(event.target.value); setError(''); }} maxLength={6} placeholder="6 位验证码" /></label><button type="button" className="tk-resend" disabled={cooldown > 0} onClick={() => { void perform(send); }}>{cooldown > 0 ? `${cooldown} 秒后可重发` : '重新发送验证码'}</button></>}
        {(intent === 'login' || stage === 'password') && <><label htmlFor="tk-password">密码</label><div className="tk-password"><input id="tk-password" type={visible ? 'text' : 'password'} name="password" autoComplete={intent === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => { setPassword(event.target.value); setError(''); }} maxLength={64} placeholder={intent === 'login' ? '输入密码' : '8–64 个字符'} aria-describedby={error ? 'tk-account-error' : undefined} /><button type="button" aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{stage === 'password' && <label htmlFor="tk-confirmation">确认密码<input id="tk-confirmation" type={visible ? 'text' : 'password'} name="confirmation" autoComplete="new-password" maxLength={64} value={confirmation} onChange={event => { setConfirmation(event.target.value); setError(''); }} placeholder="再次输入密码" /></label>}{intent === 'login' && <Link href="/login?intent=recover" className="tk-forgot" onClick={event => follow(event, '/login?intent=recover')}>忘记密码？</Link>}</>}
        {register && stage === 'password' && <div className="tk-consent"><label><input type="checkbox" checked={agreed} onChange={event => { setAgreed(event.target.checked); setError(''); }} />已阅读并同意</label><button type="button" onClick={() => setAgreement(true)}>《用户协议》</button></div>}
        <button type="submit" className="tk-submit">{busy ? '正在处理…' : label}<ArrowRight size={18} /></button>
        {register && stage !== 'invite' && <button type="button" className="tk-resend" onClick={changeEmail}>更换邀请码</button>}
      </fieldset>
      <div className="tk-account-links">{intent === 'login' ? <Link href="/login?intent=register" onClick={event => follow(event, '/login?intent=register')}>注册账号</Link> : <Link href="/login" aria-disabled={busy || loading || loadFailed} onClick={event => follow(event, '/login')}><ArrowLeft size={15} />返回登录</Link>}<button type="button" onClick={() => setAgreement(true)}>用户协议</button></div>
    </form></section>
    {agreement && <AgreementNotice onClose={() => setAgreement(false)} />}
  </div>;
}
