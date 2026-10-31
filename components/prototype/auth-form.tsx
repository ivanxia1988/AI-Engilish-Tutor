'use client';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { changePrototypeAuth, navigatePrototypeAuth, requestPrototypeCode, submitPrototypeAuth, type PrototypeAuth } from '../../lib/prototype-auth';

export function PrototypeAuthForm({ state, onChange, onAuthenticated, onAgreement, onDemo }: {
  state: PrototypeAuth;
  onChange: Dispatch<SetStateAction<PrototypeAuth>>;
  onAuthenticated: (destination: 'profile' | 'home') => void;
  onAgreement: () => void;
  onDemo: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false), [visible, setVisible] = useState(false);
  const form = useRef<HTMLFormElement>(null), generation = useRef(0);
  useEffect(() => { generation.current++; return () => { generation.current++; }; }, []);
  useEffect(() => { setVisible(false); form.current?.querySelector<HTMLInputElement>('input:not([type=checkbox])')?.focus(); }, [state.stage]);
  const passwordStep = state.stage === 'set-password' || state.stage === 'reset-password';
  const codeStep = state.stage === 'register' || state.stage === 'recover';
  const title = { login: '欢迎来到 Teeko', invite: '填写邀请码', register: '注册账号', 'set-password': '设置密码', recover: '找回密码', 'reset-password': '重置密码' }[state.stage];
  const submitLabel = { login: '登录', invite: '验证并继续', register: '下一步', 'set-password': '完成注册', recover: '下一步', 'reset-password': '保存新密码' }[state.stage];
  const edit = (fields: Parameters<typeof changePrototypeAuth>[1]) => onChange(current => changePrototypeAuth(current, fields));
  return <form ref={form} className="tp-auth-form tp-password-auth" noValidate onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    const request = generation.current; setBusy(true);
    try {
      const result = await submitPrototypeAuth(state);
      if (request !== generation.current) return;
      onChange(result.state);
      if (result.destination) onAuthenticated(result.destination);
    } catch {
      if (request === generation.current) onChange(current => ({ ...current, error: '暂时无法完成，请重试。' }));
    } finally { if (request === generation.current) setBusy(false); }
  }}>
    <div className="tp-form-heading"><h2>{title}</h2></div>
    <fieldset className="tp-auth-fields" disabled={busy} aria-busy={busy}>
      {state.stage === 'invite' ? <label htmlFor="tp-signup-invite">邀请码<input id="tp-signup-invite" name="invitation" value={state.invite} onChange={event => edit({ invite: event.target.value })} maxLength={32} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="输入你收到的邀请码" aria-invalid={!!state.error} aria-describedby={state.error ? 'tp-auth-error' : undefined} /></label> : <>
      {passwordStep ? <div className="tp-auth-verified"><span>{state.email.trim()}</span><button type="button" onClick={() => onChange(current => navigatePrototypeAuth(current, state.stage === 'set-password' ? 'register' : 'recover'))}>更换邮箱</button></div> : <label htmlFor="tp-login-email">邮箱<input id="tp-login-email" name="email" type="email" autoComplete="email" placeholder="请输入邮箱地址" value={state.email} onChange={event => edit({ email: event.target.value })} maxLength={254} /></label>}
      {codeStep ? <>
        <label htmlFor="tp-login-code">验证码</label>
        <div className="tp-input-action"><input id="tp-login-code" name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" value={state.code} onChange={event => edit({ code: event.target.value.replace(/\D/g, '') })} maxLength={6} /><button type="button" onClick={() => {
          const next = requestPrototypeCode(state); onChange(next);
          if (next.issued && !next.error) onDemo('演示验证码已填入，未发送真实邮件。');
        }}>{state.issued ? '重新发送' : '发送验证码'}</button></div>
        {state.stage === 'register' && <label className="tp-check-label"><input type="checkbox" checked={state.consent} onChange={event => edit({ consent: event.target.checked })} /><span>已阅读并同意<button type="button" onClick={onAgreement}>《用户协议》</button></span></label>}
      </> : <>
        <label htmlFor="tp-login-password">{passwordStep ? '新密码' : '密码'}</label>
        <div className="tp-password-input"><input id="tp-login-password" name="password" type={visible ? 'text' : 'password'} autoComplete={passwordStep ? 'new-password' : 'current-password'} placeholder={passwordStep ? '8–64 位，区分大小写' : '请输入密码'} value={state.password} onChange={event => edit({ password: event.target.value })} maxLength={64} aria-describedby={state.error ? 'tp-auth-error' : undefined} /><button type="button" aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
        {passwordStep && <label htmlFor="tp-confirm-password">确认密码<input id="tp-confirm-password" name="confirmation" type={visible ? 'text' : 'password'} autoComplete="new-password" placeholder="再次输入密码" value={state.confirmation} onChange={event => edit({ confirmation: event.target.value })} maxLength={64} /></label>}
        {state.stage === 'login' && <button type="button" className="tp-auth-forgot" onClick={() => onChange(current => navigatePrototypeAuth(current, 'recover'))}>忘记密码？</button>}
      </>}
      </>}
      {state.error && <p id="tp-auth-error" className="tp-form-error" role="alert">{state.error}</p>}
      {state.message && <p className="tp-auth-success" role="status">{state.message}</p>}
      <button type="submit" className="tp-button tp-primary">{busy ? '正在处理…' : submitLabel}<ArrowRight size={18} /></button>
      {(state.stage === 'register' || state.stage === 'set-password') && <button type="button" className="tp-text-button" onClick={() => onChange(current => navigatePrototypeAuth(current, 'invite'))}>更换邀请码</button>}
      {state.stage === 'login' ? <div className="tp-auth-links"><button type="button" onClick={() => onChange(current => navigatePrototypeAuth(current, 'register'))}>注册账号</button><button type="button" onClick={onAgreement}>用户协议</button></div> : <button type="button" className="tp-text-button" onClick={() => onChange(current => navigatePrototypeAuth(current, 'login'))}><ArrowLeft size={16} />返回登录</button>}
    </fieldset>
  </form>;
}
