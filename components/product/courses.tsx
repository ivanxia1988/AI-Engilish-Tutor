'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BookOpen, LogOut, RotateCcw } from 'lucide-react';
import { z } from 'zod';
import { AccountRequestError, accountRequest, destination, errorMessage, navigateProduct, type ProductDestination } from './account-request';

const coursesResponse = z.object({ ok: z.literal(true), courses: z.array(z.never()) });
export function Courses({ navigate = navigateProduct }: { navigate?: (path: ProductDestination) => void }) {
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false);
  const mounted = useRef(false), locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    accountRequest('/courses', coursesResponse, { signal: controller.signal }).then(() => {
      if (controller.signal.aborted) return;
      setLoading(false); setError('');
    }).catch(failure => {
      if (controller.signal.aborted) return;
      if (failure instanceof AccountRequestError && failure.status === 401) { navigate('/login'); return; }
      setLoading(false); setError(errorMessage(failure));
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [attempt, navigate]);
  async function logout() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await accountRequest('/auth/logout', destination, { body: {} });
      if (mounted.current) navigate(result.next);
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <main className="tk-product tk-courses-page">
    <header className="tk-product-header"><Link href="/" className="tk-wordmark" aria-label="Teeko 首页">Tee<span>ko</span><img src="/prototype-assets/teeko-head-icon.svg" alt="" /></Link><nav><Link href="/onboarding">孩子档案</Link><button type="button" disabled={busy} onClick={() => { void logout(); }}><LogOut size={16} />{busy ? '正在退出…' : '退出登录'}</button></nav></header>
    <section className="tk-courses-content"><h1>我的课程</h1>{loading ? <p role="status">正在读取课程…</p> : error ? <div className="tk-courses-empty"><p className="tk-account-error" role="alert">{error}</p><button type="button" className="tk-submit" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}><RotateCcw size={16} />重新读取</button></div> : <div className="tk-courses-empty"><BookOpen size={40} strokeWidth={1.3} /><h2>课程准备中</h2><p>课程发布后会显示在这里。</p></div>}</section>
  </main>;
}
