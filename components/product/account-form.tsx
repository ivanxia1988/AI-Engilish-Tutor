'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { accountSubmissionError, type AccountIntent } from './account-state';
import { AgreementNotice } from './agreement-notice';

export function AccountForm({ intent }: { intent: AccountIntent }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invitation, setInvitation] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [agreement, setAgreement] = useState(false);
  const register = intent === 'register', recover = intent === 'recover';
  return <div className="tk-product tk-account">
    <section className="tk-account-story">
      <Link href="/" className="tk-wordmark" aria-label="Teeko 首页">Tee<span>ko</span><img src="/prototype-assets/teeko-head-icon.svg" alt="" /></Link>
      <div><span className="tk-age">8–13 岁 · 英语口语</span><h1>让孩子<br />自在地开口。</h1><p>一位有耐心的老师，<br />一页熟悉的课本，一次小小的进步。</p></div>
      <img className="tk-account-bird" src="/prototype-assets/pose-handoff.svg" alt="Teeko 小麻雀老师" />
    </section>
    <section className="tk-account-main">
      <form noValidate onSubmit={event => { event.preventDefault(); setError(accountSubmissionError(intent, { email, password, invitation })); }} aria-labelledby="tk-account-title">
        <h2 id="tk-account-title">{register ? '填写邀请码' : recover ? '找回密码' : '欢迎来到 Teeko'}</h2>
        {register ? <label htmlFor="tk-invitation">邀请码<input id="tk-invitation" name="invitation" value={invitation} onChange={event => { setInvitation(event.target.value); setError(''); }} maxLength={32} placeholder="输入你收到的邀请码" autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby={error ? 'tk-account-error' : undefined} /></label> : <>
          <label htmlFor="tk-email">邮箱<input id="tk-email" type="email" name="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setError(''); }} maxLength={254} placeholder="输入邮箱地址" aria-describedby={error ? 'tk-account-error' : undefined} /></label>
          {!recover && <><label htmlFor="tk-password">密码</label><div className="tk-password"><input id="tk-password" type={visible ? 'text' : 'password'} name="password" autoComplete="current-password" value={password} onChange={event => { setPassword(event.target.value); setError(''); }} maxLength={64} placeholder="输入密码" aria-describedby={error ? 'tk-account-error' : undefined} /><button type="button" aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div><Link href="/login?intent=recover" className="tk-forgot">忘记密码？</Link></>}
        </>}
        {error && <p id="tk-account-error" className="tk-account-error" role="alert">{error}</p>}
        <button type="submit" className="tk-submit">{register ? '验证并继续' : recover ? '发送验证码' : '登录'}<ArrowRight size={18} /></button>
        <div className="tk-account-links">{intent === 'login' ? <Link href="/login?intent=register">注册账号</Link> : <Link href="/login"><ArrowLeft size={15} />返回登录</Link>}<button type="button" onClick={() => setAgreement(true)}>用户协议</button></div>
      </form>
    </section>
    {agreement && <AgreementNotice onClose={() => setAgreement(false)} />}
  </div>;
}
