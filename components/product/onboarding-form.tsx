'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AccountRequestError, accountRequest, childProfile, errorMessage, navigateProduct, profileResponse, type ChildProfile, type ProductDestination } from './account-request';

const AGES = ['8–9', '10–11', '12–13'] as const;
const LEVELS = [
  { id: 'starter', title: '刚开始学', example: '只认得 Hello、apple 这类词' },
  { id: 'sentences', title: '能说简单句', example: '能说 “I like apples.”，表达喜好' },
  { id: 'conversation', title: '能简单聊天', example: '能用英语聊兴趣、学校或周末' },
  { id: 'unsure', title: '不确定', example: '第一课再了解一下' },
] as const;
export function OnboardingForm({ navigate = navigateProduct }: { navigate?: (path: ProductDestination) => void }) {
  const [profile, setProfile] = useState<ChildProfile>({ name: '', ageRange: '10–11', level: 'unsure' });
  const [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false), [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(false), locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    accountRequest('/profile', profileResponse, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (result.profile) setProfile(result.profile);
      setError(''); setLoadFailed(false); setLoading(false);
    }).catch(failure => {
      if (controller.signal.aborted) return;
      if (failure instanceof AccountRequestError && failure.status === 401) { navigate('/login'); return; }
      setError(errorMessage(failure)); setLoadFailed(true); setLoading(false);
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [attempt, navigate]);
  async function save() {
    if (locked.current || loading || loadFailed) return;
    const parsed = childProfile.safeParse(profile);
    if (!parsed.success) { setError('请填写孩子的称呼（最多 30 个字符）。'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await accountRequest('/profile', profileResponse, { method: 'PATCH', body: parsed.data });
      if (!result.profile) throw new Error('档案尚未保存，请重试。');
      if (mounted.current) navigate('/courses');
    } catch (failure) {
      if (mounted.current) {
        if (failure instanceof AccountRequestError && failure.status === 401) navigate('/login');
        else setError(errorMessage(failure));
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <main className="tk-product tk-profile-page">
    <header className="tk-product-header"><Link href="/" className="tk-wordmark" aria-label="Teeko 首页">Tee<span>ko</span><img src="/prototype-assets/teeko-head-icon.svg" alt="" /></Link><span>孩子档案</span></header>
    <form className="tk-profile-content" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <h1>Teeko 该怎么称呼孩子？</h1>
      {loading && <p role="status">正在读取档案…</p>}
      {error && <p className="tk-account-error" role="alert">{error}</p>}
      {loadFailed && <button className="tk-submit" type="button" onClick={() => { setLoading(true); setLoadFailed(false); setAttempt(value => value + 1); }}>重新读取</button>}
      <fieldset disabled={busy || loading || loadFailed} className="tk-profile-fields">
        <div className="tk-profile-grid"><section className="tk-profile-card">
          <label htmlFor="tk-child-name">孩子的称呼<input id="tk-child-name" autoComplete="nickname" value={profile.name} maxLength={20} onChange={event => { setProfile(current => ({ ...current, name: event.target.value })); setError(''); }} placeholder="输入孩子的称呼" /></label>
          <fieldset className="tk-profile-options"><legend>年龄</legend><div className="tk-age-options">{AGES.map(age => <label className="tk-choice" key={age}><input type="radio" name="ageRange" value={age} checked={profile.ageRange === age} onChange={() => setProfile(current => ({ ...current, ageRange: age }))} /><span>{age} 岁</span></label>)}</div></fieldset>
          <fieldset className="tk-profile-options"><legend>现在的英语基础</legend><div className="tk-level-options">{LEVELS.map(level => <label className="tk-choice" key={level.id}><input type="radio" name="level" value={level.id} checked={profile.level === level.id} onChange={() => setProfile(current => ({ ...current, level: level.id }))} /><span><strong>{level.title}</strong><small>{level.example}</small></span></label>)}</div></fieldset>
        </section><aside className="tk-profile-greeting"><img src="/prototype-assets/pose-idle-listening.svg" alt="Teeko 小麻雀老师" /><h2>Hi{profile.name.trim() ? `, ${profile.name.trim()}` : ''}!</h2></aside></div>
        <footer className="tk-profile-actions"><button className="tk-submit" type="submit">{busy ? '正在保存…' : '保存并继续'}<ArrowRight size={18} /></button></footer>
      </fieldset>
    </form>
  </main>;
}
