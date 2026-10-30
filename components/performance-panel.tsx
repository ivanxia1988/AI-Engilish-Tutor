"use client";
import { VOICE_PROVIDERS, voicePathLabel, type VoiceProviderId } from '@/lib/voice-provider';
import { useEffect, useState } from 'react';
import { loadPerformanceReports, performanceReportCSV, performanceReportJSON, type LivePerformanceReport, type LivePerformanceSummary, type PerformanceMeasureName } from '@/lib/live-performance';

const ms = (value?: number | null) => value == null ? '—' : `${Math.round(value)} ms`;
const pct = (value?: number | null) => value == null ? '—' : `${value.toFixed(1)}%`;
const timingRows: [PerformanceMeasureName, string][] = [
  ['startup_total', '点击开始 → 接通'], ['session_http', '建连 HTTP 往返'], ['session_server_total', '建连：服务端总耗时'], ['session_upstream', '建连：上游 API 耗时'],
  ['first_teacher_audio', '点击开始 → 老师音轨首声'], ['child_to_teacher_gap', '孩子停声 → 老师起声（估算）'], ['control_to_audio', '程序请求 → 老师起声（估算）'], ['context_injection', '状态发送 → 注入确认'],
  ['agent_queue', '后台任务排队'], ['agent_http', 'Luna HTTP 往返'], ['agent_server_total', 'Luna：服务端总耗时'], ['agent_upstream', 'Luna：上游 API 耗时'], ['tool_total', '课堂工具执行'],
  ['vision_http', '视觉 HTTP 往返'], ['vision_server_total', '视觉：服务端总耗时'], ['vision_upstream', '视觉：上游 API 耗时'], ['event_loop_lag', '浏览器计时器延迟'], ['websocket_ping', '浏览器到网站的 WS 往返（不含上游）'], ['playback_queue', 'PCM 播放排队时长'],
];
function download(report: LivePerformanceReport, format: 'json' | 'csv') {
  const data = format === 'json' ? performanceReportJSON(report) : performanceReportCSV(report);
  const url = URL.createObjectURL(new Blob([data], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `littleleaf-performance-${report.startedAt.replace(/[:.]/g, '-')}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PerformancePanel({ provider = 'openai', summary, active, strategy, onStrategy, onMark, getReport }: { provider?: VoiceProviderId; summary: LivePerformanceSummary | null; active: boolean; strategy: string; onStrategy: (label: string) => void; onMark: () => void; getReport: () => LivePerformanceReport | null }) {
  const [saved, setSaved] = useState<LivePerformanceReport[]>([]);
  useEffect(() => { setSaved(loadPerformanceReports()); }, [active]);
  const latest = summary?.latest;
  const reportProvider = summary ? getReport()?.provider || provider : provider;
  const current = () => getReport() || saved[0] || null;
  return <details className="performance-panel"><summary>家长调试 · 流畅度记录</summary><div className="performance-content">
    <p><strong>{VOICE_PROVIDERS[reportProvider].name}</strong> · {voicePathLabel(VOICE_PROVIDERS[reportProvider].transport)}。{VOICE_PROVIDERS[reportProvider].transport === 'websocket_relay' ? '此线路经过网站后端；不提供 RTP 丢包统计，空值不代表零丢包。' : '媒体 RTT 与丢包来自实际 WebRTC 连接。'}</p>
    <p>连接期间自动记录性能数据；不记录录音、转写、教材正文、IP 或密钥。</p>
    <label>实验标签（仅标记，不更改设置）<select aria-label="流畅度实验标签" value={strategy} onChange={e => onStrategy(e.target.value)} disabled={!active}><option value="baseline">当前设置</option><option value="network_a">网络方案 A</option><option value="network_b">网络方案 B</option><option value="prompt_a">提示词方案 A</option><option value="prompt_b">提示词方案 B</option></select></label>
    <div className="performance-actions"><button className="button secondary small-button" onClick={onMark} disabled={!active}>刚才卡了一下</button><span>已标记 {summary?.stutterMarkers || 0} 次 · {summary?.sampleCount || 0} 个采样</span></div>
    <dl className="performance-metrics"><div><dt>媒体 RTT</dt><dd>{ms(latest?.rttMs)}</dd></div><div><dt>接收抖动</dt><dd>{ms(latest?.inboundJitterMs)}</dd></div><div><dt>缓冲延迟</dt><dd>{ms(latest?.jitterBufferMs)}</dd></div><div><dt>区间丢包</dt><dd>{pct(latest?.inboundPacketLossPct)}</dd></div><div><dt>补偿音频样本</dt><dd>{pct(latest?.concealmentPct)}</dd></div><div><dt>传输路径</dt><dd>{latest?.route === 'relay' ? '中继' : latest?.route === 'direct' ? '非中继' : '—'}{latest?.protocol ? ` / ${latest.protocol.toUpperCase()}` : ''}</dd></div></dl>
    <p>下表汇总当前记录中的所有实验标签；按方案分别比较，请筛选导出文件的 strategy 列。</p>
    {summary && <div className="performance-table-wrap"><table><thead><tr><th>阶段</th><th>P50</th><th>P95</th><th>次数</th></tr></thead><tbody>{timingRows.filter(([key]) => summary.measurements[key]).map(([key, label]) => { const value = summary.measurements[key]!; return <tr key={key}><td>{label}</td><td>{ms(value.p50Ms)}</td><td>{ms(value.p95Ms)}</td><td>{value.count}</td></tr>; })}</tbody></table></div>}
    <div className="performance-actions"><button className="text-button" disabled={!summary && !saved.length} onClick={() => { const report = current(); if (report) download(report, 'json'); }}>导出当前记录 JSON</button><button className="text-button" disabled={!summary && !saved.length} onClick={() => { const report = current(); if (report) download(report, 'csv'); }}>导出 CSV</button></div>
    <button className="text-button" onClick={() => setSaved(loadPerformanceReports())}>读取最近记录</button>
    {saved.map((report, i) => <div className="performance-saved" key={report.startedAt}><span>{new Date(report.startedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · {report.samples.length} 个采样 · {VOICE_PROVIDERS[report.provider || 'openai'].name}</span><button className="text-button" onClick={() => download(report, 'json')}>导出第 {i + 1} 次</button></div>)}
    <p className="performance-caveat">每 2 秒采样，未支持的指标显示“—”。丢包和补音是卡顿线索，不能单独证明听感卡顿；正常停顿不计为卡顿。上游耗时包含 API 网络与服务处理，不是纯推理时间。停声/起声由音量估算，不代表精确回合边界或扬声器实际播出。记录保留在本机，最多最近 3 次；小样本 P95 仅供观察。</p>
  </div></details>;
}
