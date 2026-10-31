'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Radio } from 'lucide-react';
import { LiveClassroomClient } from '../../lib/live-client';
import { providerReadiness, type PrototypeProvider } from '../../lib/prototype-connectivity';

export function ProviderConnectionCheck({ provider }: { provider: PrototypeProvider }) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'passed' | 'failed' | 'login'>('idle');
  const [message, setMessage] = useState('');
  const generation = useRef(0), busy = useRef(false), client = useRef<LiveClassroomClient | null>(null);
  const abort = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { generation.current++; abort.current?.abort(); if (timer.current) clearTimeout(timer.current); client.current?.dispose(); }, []);
  async function check() {
    if (busy.current) return;
    const attempt = ++generation.current; busy.current = true; setStatus('checking'); setMessage('正在检查服务与浏览器实时连接…');
    const current = () => generation.current === attempt;
    const finish = (next: 'passed' | 'failed' | 'login', text: string) => {
      if (!current()) return;
      if (timer.current) clearTimeout(timer.current); timer.current = null; busy.current = false; client.current = null;
      setStatus(next); setMessage(text);
    };
    try {
      abort.current = new AbortController();
      timer.current = setTimeout(() => abort.current?.abort(), 6000);
      const response = await fetch('/api/status', { credentials: 'same-origin', cache: 'no-store', signal: abort.current.signal });
      if (!response.ok) throw new Error('检测服务暂不可用，请稍后重试。');
      const readiness = providerReadiness(await response.json(), provider);
      if (timer.current) clearTimeout(timer.current); timer.current = null;
      if (!current()) return;
      if (readiness === 'login') { finish('login', '当前是演示登录。完成真实登录后，才能检测实时语音连接。'); return; }
      if (readiness === 'configuration') { finish('failed', '该服务尚未配置，请联系网站管理员。'); return; }
      if (readiness !== 'ready') throw new Error('未取得完整的检测状态，请重试。');
      let connected = false, failure = '';
      const instance = new LiveClassroomClient({
        state: state => {
          if (!current()) return;
          if (state === 'connected') connected = true;
          if (state === 'closed' || state === 'error') finish(connected && !failure ? 'passed' : 'failed', connected && !failure ? '实时连接成功，测试会话已关闭。' : failure || '未能建立实时连接，请检查网络后重试。');
        },
        error: text => { if (current()) { failure = text; setMessage(text); } },
      }, undefined, provider);
      client.current = instance;
      timer.current = setTimeout(() => { failure = '连接超时，请检查网络或 VPN／代理设置。'; void instance.stop(); }, 55_000);
      await instance.start('probe');
    } catch (error) {
      finish('failed', error instanceof Error && error.name !== 'AbortError' ? error.message : '检测超时，请检查网络后重试。');
    }
  }
  return <div className="tp-provider-check"><button type="button" className="tp-button tp-secondary" onClick={() => void check()} disabled={status === 'checking'}>{status === 'checking' ? <LoaderCircle size={15} className="tp-probe-loading" /> : status === 'passed' ? <Check size={15} /> : <Radio size={15} />}{status === 'checking' ? '正在检测…' : '检测连接'}</button><p className={`tp-probe-message tp-probe-${status}`} role="status">{message || '不打开麦克风；测试会话可能产生少量服务用量。'}</p>{status === 'login' && <a href="/" target="_blank" rel="noreferrer">打开现有课堂完成登录 ↗</a>}</div>;
}
