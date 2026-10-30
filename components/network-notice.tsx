"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkNetwork, mediaPoor, type NetworkCheckResult } from '@/lib/network-check';
import type { LivePerformanceSample } from '@/lib/live-performance';

export function NetworkNotice({ active, sample }: { active: boolean; sample: LivePerformanceSample | null }) {
  const [result, setResult] = useState<NetworkCheckResult | null>(null), [checking, setChecking] = useState(true), [mediaWarning, setMediaWarning] = useState(false);
  const controller = useRef<AbortController | null>(null), generation = useRef(0), lastCheckAt = useRef(0), mediaCounts = useRef({ bad: 0, good: 0, at: -1 });
  const run = useCallback(async () => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request; const version = ++generation.current;
    lastCheckAt.current = Date.now(); setChecking(true);
    try { const next = await checkNetwork({ signal: request.signal, onlineHint: navigator.onLine }); if (version === generation.current) setResult(next); }
    catch { /* Aborted checks never overwrite a newer result or notify after unmount. */ }
    finally { if (version === generation.current) setChecking(false); }
  }, []);
  useEffect(() => {
    void run();
    const online = () => { void run(); };
    const offline = () => { controller.current?.abort(); generation.current++; setChecking(false); setResult({ status: 'offline', medianMs: null, spreadMs: null, succeeded: 0, attempted: 0 }); };
    const visible = () => { if (document.visibilityState === 'visible' && Date.now() - lastCheckAt.current > 60_000) void run(); };
    window.addEventListener('online', online); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', visible);
    return () => { generation.current++; controller.current?.abort(); window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
  }, [run]);
  useEffect(() => {
    if (!active) { mediaCounts.current = { bad: 0, good: 0, at: -1 }; setMediaWarning(false); return; }
    if (!sample || sample.atMs === mediaCounts.current.at) return;
    if (![sample.rttMs, sample.inboundJitterMs, sample.jitterBufferMs, sample.inboundPacketLossPct, sample.concealmentPct].some(v => typeof v === 'number' && Number.isFinite(v))) return;
    const counts = mediaCounts.current; counts.at = sample.atMs;
    if (mediaPoor(sample)) { counts.bad++; counts.good = 0; if (counts.bad >= 2) setMediaWarning(true); }
    else { counts.good++; counts.bad = 0; if (counts.good >= 3) setMediaWarning(false); }
  }, [active, sample]);
  const warning = mediaWarning || (result !== null && result.status !== 'good');
  let title = '正在检测网站连接…', detail = '轻量检测不会打开麦克风，也不会启动语音会话。';
  if (mediaWarning) { title = '当前语音线路质量较差'; detail = '连续采样发现延迟、抖动或丢包偏高，对话可能卡顿。建议切换网络；也可以先用文字和圈画继续。'; }
  else if (result?.status === 'poor') { title = '当前网站连接较慢或不稳定'; detail = '实时互动可能出现等待或卡顿。建议切换到更稳定的网络后重新检测。'; }
  else if (result?.status === 'offline') { title = '设备提示可能已离线'; detail = '请检查 Wi-Fi 或移动网络，也可以重新检测。已打开的教材仍可浏览。'; }
  else if (result?.status === 'unavailable') { title = '网站连接检测未成功'; detail = '可能是网络或检测服务暂时异常，请稍后重试；这不代表已确认语音线路中断。'; }
  else if (result?.status === 'good') { title = `网站连接正常${result.medianMs === null ? '' : ` · ${Math.round(result.medianMs)} ms`}`; detail = '这是到网站的连接检测；实时语音线路会在通话后继续检测。'; }
  return <section className={`network-notice ${warning ? 'network-warning' : 'network-normal'}`} role={warning ? 'alert' : 'status'} aria-label="网络状态"><span className="network-indicator" aria-hidden="true" /><div><strong>{title}</strong><p>{detail}</p></div><button className="text-button" onClick={() => { void run(); }} disabled={checking}>{checking ? '检测中…' : '重新检测网络'}</button></section>;
}
