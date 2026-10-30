import { voiceProvider, VOICE_PROVIDERS, type VoiceProviderId, type VoiceTransportKind } from './voice-provider';
/** Allowlisted diagnostics only: never retain raw RTCStats, audio, transcripts, addresses or SDP. */
export const PERFORMANCE_MEASURES = ['startup_total', 'microphone_permission', 'ice_gathering', 'session_http', 'session_server_total', 'session_upstream', 'connection_ready', 'first_teacher_audio', 'context_injection', 'agent_queue', 'agent_http', 'agent_server_total', 'agent_upstream', 'tool_total', 'vision_http', 'vision_server_total', 'vision_upstream', 'control_to_audio', 'child_to_teacher_gap', 'event_loop_lag', 'websocket_ping', 'playback_queue'] as const;
export type PerformanceMeasureName = typeof PERFORMANCE_MEASURES[number];
export const PERFORMANCE_STRATEGIES = ['baseline', 'network_a', 'network_b', 'prompt_a', 'prompt_b'] as const;
export type PerformanceStrategy = typeof PERFORMANCE_STRATEGIES[number];
export type LivePerformanceSample = {
  atMs: number; strategy: PerformanceStrategy; intervalMs: number | null;
  rttMs: number | null; inboundJitterMs: number | null; jitterBufferMs: number | null;
  inboundPacketLossPct: number | null; inboundPacketsReceived: number | null; inboundPacketsLost: number | null; recoveredPackets: number | null;
  concealmentPct: number | null; concealmentEvents: number | null; inboundKbps: number | null;
  upstreamPacketLossPct: number | null; upstreamRttMs: number | null; playoutSynthesizedMs: number | null;
  route: 'relay' | 'direct' | null; protocol: 'udp' | 'tcp' | null;
};
export type LivePerformanceEvent = { type: 'measure'; atMs: number; strategy: PerformanceStrategy; name: PerformanceMeasureName; durationMs: number } | { type: 'user_stutter'; atMs: number; strategy: PerformanceStrategy } | { type: 'strategy_change'; atMs: number; strategy: PerformanceStrategy };
export type PerformanceDistribution = { count: number; p50Ms: number; p95Ms: number; maxMs: number };
export type LivePerformanceSummary = { sampleCount: number; stutterMarkers: number; latest: LivePerformanceSample | null; measurements: Partial<Record<PerformanceMeasureName, PerformanceDistribution>> };
export type LivePerformanceReport = { schemaVersion: 1; provider?: VoiceProviderId; transport?: VoiceTransportKind; model?: string; startedAt: string; strategy: PerformanceStrategy; durationMs: number; samples: LivePerformanceSample[]; events: LivePerformanceEvent[]; summary: LivePerformanceSummary; caveats: string[] };
const LIMIT = 400, STORAGE_KEY = 'littleleaf-performance-v1';
const CAVEATS = [
  'Missing or unsupported metrics are null, never zero. The first sample establishes counter baselines.',
  'RTT is a round-trip estimate, not one-way audio latency. Jitter and jitter-buffer delay use seconds converted to milliseconds.',
  'Packet loss, concealed samples and synthesized playout are network/playout evidence; they do not prove an audible freeze. Normal speech pauses are not counted as freezes.',
  'child_to_teacher_gap is an estimate from local voice activity, not a model turn boundary or exact perception latency. control_to_audio can include generation, network, buffering and playback.',
  'The RMS estimate measures last child voice to first received teacher energy; application-triggered output and overlaps should be excluded. It is not exact endpointing, inference time or physical speaker playback.',
  'The report provider, requested model and transport identify this connection. webrtc_direct media travels from the browser to the selected provider; websocket_relay includes the application backend in the audio path. Analyze unlike paths separately.',
  'websocket_ping measures only browser-to-application-server round trip, not provider RTT. playback_queue measures scheduled PCM audio waiting, not packet loss. Unsupported relay media metrics remain null.',
  'HTTP phase measurements may include failed/timeout attempts as well as successes; inspect server status logs before interpreting them as successful-response latency.',
  'Measurements and samples are bounded to the newest 400 entries. Strategy labels are annotations, not proof of an optimization causing a change.',
];
const safeModel = (value: unknown): string | undefined => typeof value === 'string' && value.length <= 100 && /^(?:gpt-[A-Za-z0-9._-]+|qwen[A-Za-z0-9._-]+|glm-[A-Za-z0-9._-]+|[0-9]+(?:\.[0-9]+){1,5})$/.test(value) ? value : undefined;
const MEASURES = new Set<string>(PERFORMANCE_MEASURES);
const strategy = (value: unknown): PerformanceStrategy => typeof value === 'string' && (PERFORMANCE_STRATEGIES as readonly string[]).includes(value) ? value as PerformanceStrategy : 'baseline';
function isoDate(value: unknown) { const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null; return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString(); }
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonnegative = (value: unknown): number | null => { const n = finite(value); return n === null || n < 0 ? null : n; };
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const mean = (values: (number | null)[]) => { const present = values.filter((v): v is number => v !== null); return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null; };
const sum = (values: (number | null)[]) => { const present = values.filter((v): v is number => v !== null); return present.length ? present.reduce((a, b) => a + b, 0) : null; };
const ratio = (a: number | null, b: number | null, scale = 1) => a !== null && b !== null && b > 0 ? Math.min(scale, Math.max(0, a / b * scale)) : null;
const ms = (value: unknown) => { const n = nonnegative(value); return n === null ? null : n * 1000; };
type Baseline = { at: number; timestamp: number | null; packetsReceived: number | null; packetsLost: number | null; bytesReceived: number | null; jitterBufferDelay: number | null; jitterBufferEmittedCount: number | null; totalSamplesReceived: number | null; concealedSamples: number | null; concealmentEvents: number | null; synthesizedSamplesDuration: number | null };
function baseline(row: Record<string, unknown>, at: number): Baseline {
  return { at, timestamp: finite(row.timestamp), packetsReceived: nonnegative(row.packetsReceived), packetsLost: finite(row.packetsLost), bytesReceived: nonnegative(row.bytesReceived), jitterBufferDelay: nonnegative(row.jitterBufferDelay), jitterBufferEmittedCount: nonnegative(row.jitterBufferEmittedCount), totalSamplesReceived: nonnegative(row.totalSamplesReceived), concealedSamples: nonnegative(row.concealedSamples), concealmentEvents: nonnegative(row.concealmentEvents), synthesizedSamplesDuration: nonnegative(row.synthesizedSamplesDuration) };
}
function delta(current: number | null, previous: number | null, signed = false) { return current === null || previous === null || (!signed && current < previous) ? null : current - previous; }
const NUMERIC_SAMPLE_KEYS = ['intervalMs', 'rttMs', 'inboundJitterMs', 'jitterBufferMs', 'inboundPacketLossPct', 'inboundPacketsReceived', 'inboundPacketsLost', 'recoveredPackets', 'concealmentPct', 'concealmentEvents', 'inboundKbps', 'upstreamPacketLossPct', 'upstreamRttMs', 'playoutSynthesizedMs'] as const;
function emptySample(atMs: number, label: PerformanceStrategy): LivePerformanceSample { return { atMs, strategy: label, intervalMs: null, rttMs: null, inboundJitterMs: null, jitterBufferMs: null, inboundPacketLossPct: null, inboundPacketsReceived: null, inboundPacketsLost: null, recoveredPackets: null, concealmentPct: null, concealmentEvents: null, inboundKbps: null, upstreamPacketLossPct: null, upstreamRttMs: null, playoutSynthesizedMs: null, route: null, protocol: null }; }
function summarize(samples: LivePerformanceSample[], events: LivePerformanceEvent[]): LivePerformanceSummary {
  const measurements: LivePerformanceSummary['measurements'] = {};
  for (const name of PERFORMANCE_MEASURES) {
    const values = events.filter((e): e is Extract<LivePerformanceEvent, { type: 'measure' }> => e.type === 'measure' && e.name === name).map(e => e.durationMs).sort((a, b) => a - b);
    if (values.length) measurements[name] = { count: values.length, p50Ms: values[Math.max(0, Math.ceil(values.length * .5) - 1)], p95Ms: values[Math.max(0, Math.ceil(values.length * .95) - 1)], maxMs: values.at(-1)! };
  }
  return { sampleCount: samples.length, stutterMarkers: events.filter(e => e.type === 'user_stutter').length, latest: samples.at(-1) || null, measurements };
}

export class LivePerformanceCollector {
  private readonly now: () => number;
  private readonly provider: VoiceProviderId;
  private model: string | undefined;
  private readonly transport: VoiceTransportKind;
  private readonly startedAt: number;
  private readonly startedAtISO: string;
  private label: PerformanceStrategy;
  private samples: LivePerformanceSample[] = [];
  private events: LivePerformanceEvent[] = [];
  private previous = new Map<string, Baseline>();
  private previousAt: number | null = null;
  private finishedAt: number | null = null;
  constructor(options: { now?: () => number; strategy?: string; startedAt?: string; provider?: VoiceProviderId; transport?: VoiceTransportKind } = {}) {
    this.provider = voiceProvider(options.provider); this.transport = options.transport || VOICE_PROVIDERS[this.provider].transport;
    this.now = options.now || (() => typeof performance === 'undefined' ? Date.now() : performance.now()); this.startedAt = this.now(); this.label = strategy(options.strategy); this.startedAtISO = isoDate(options.startedAt);
  }
  private elapsed() { return Math.max(0, (this.finishedAt ?? this.now()) - this.startedAt); }
  setModel(value: unknown) { this.model = safeModel(value); }
  finish() { this.finishedAt ??= this.now(); }
  private event(value: LivePerformanceEvent) { if (this.finishedAt !== null) return; this.events.push(value); this.events = this.events.slice(-LIMIT); }
  setStrategy(value: string) { const label = strategy(value); if (label !== this.label) { this.label = label; this.event({ type: 'strategy_change', atMs: this.elapsed(), strategy: label }); } }
  measure(name: PerformanceMeasureName, durationMs: number) { if (MEASURES.has(name) && nonnegative(durationMs) !== null) this.event({ type: 'measure', atMs: this.elapsed(), strategy: this.label, name, durationMs }); }
  markUserStutter() { this.event({ type: 'user_stutter', atMs: this.elapsed(), strategy: this.label }); }
  sample(stats: Iterable<unknown>): LivePerformanceSample {
    if (this.finishedAt !== null) return { ...(this.samples.at(-1) || emptySample(this.elapsed(), this.label)) };
    const at = this.now(), sample = emptySample(this.elapsed(), this.label);
    sample.intervalMs = this.previousAt !== null && at >= this.previousAt ? at - this.previousAt : null; this.previousAt = at;
    const rows = Array.from(stats, value => record(Array.isArray(value) && value.length === 2 ? value[1] : value)).filter((v): v is Record<string, unknown> => v !== null);
    const byId = new Map(rows.filter(r => typeof r.id === 'string').map(r => [r.id as string, r]));
    const transport = rows.find(r => r.type === 'transport' && typeof r.selectedCandidatePairId === 'string');
    let pair = transport ? byId.get(transport.selectedCandidatePairId as string) : undefined;
    if (!pair) { const selected = rows.filter(r => r.type === 'candidate-pair' && (r.selected === true || (r.nominated === true && r.state === 'succeeded'))); if (selected.length === 1) pair = selected[0]; }
    if (pair) {
      sample.rttMs = ms(pair.currentRoundTripTime);
      const local = typeof pair.localCandidateId === 'string' ? byId.get(pair.localCandidateId) : undefined;
      const remote = typeof pair.remoteCandidateId === 'string' ? byId.get(pair.remoteCandidateId) : undefined;
      if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') sample.route = 'relay';
      else if ([local?.candidateType, remote?.candidateType].every(v => ['host', 'srflx', 'prflx'].includes(String(v)))) sample.route = 'direct';
      const protocol = local?.protocol ?? remote?.protocol; if (protocol === 'udp' || protocol === 'tcp') sample.protocol = protocol;
    }
    const audio = rows.filter(r => r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio'));
    sample.inboundJitterMs = mean(audio.map(r => ms(r.jitter)));
    sample.inboundPacketsReceived = sum(audio.map(r => nonnegative(r.packetsReceived)));
    sample.inboundPacketsLost = sum(audio.map(r => finite(r.packetsLost)));
    const lossNumerators: (number | null)[] = [], lossDenominators: (number | null)[] = [], recovered: (number | null)[] = [], delay: (number | null)[] = [], emitted: (number | null)[] = [], concealed: (number | null)[] = [], totals: (number | null)[] = [], events: (number | null)[] = [], rates: (number | null)[] = [], playout: (number | null)[] = [];
    const next = new Map<string, Baseline>();
    for (const r of rows.filter(r => (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) || r.type === 'media-playout')) {
      if (typeof r.id !== 'string') continue;
      const key = `${r.type}:${r.id}:${typeof r.ssrc === 'number' || typeof r.ssrc === 'string' ? r.ssrc : ''}`;
      const current = baseline(r, at), old = this.previous.get(key); next.set(key, current);
      if (!old) continue;
      // packetsLost is signed and may fall when delayed packets arrive: that is recovery, not a reset.
      const reset = (['packetsReceived', 'bytesReceived', 'jitterBufferEmittedCount', 'totalSamplesReceived', 'concealedSamples', 'concealmentEvents', 'synthesizedSamplesDuration'] as const).some(k => current[k] !== null && old[k] !== null && current[k]! < old[k]!) || (current.timestamp !== null && old.timestamp !== null && current.timestamp < old.timestamp);
      if (reset) continue;
      const dt = current.timestamp !== null && old.timestamp !== null ? current.timestamp - old.timestamp : at - old.at;
      if (r.type === 'media-playout') { const d = delta(current.synthesizedSamplesDuration, old.synthesizedSamplesDuration); playout.push(d === null ? null : d * 1000); continue; }
      const received = delta(current.packetsReceived, old.packetsReceived), lost = delta(current.packetsLost, old.packetsLost, true);
      if (received !== null && lost !== null) { lossNumerators.push(Math.max(0, lost)); lossDenominators.push(received + Math.max(0, lost)); recovered.push(Math.max(0, -lost)); }
      const d = delta(current.jitterBufferDelay, old.jitterBufferDelay), n = delta(current.jitterBufferEmittedCount, old.jitterBufferEmittedCount);
      if (d !== null && n !== null) { delay.push(d); emitted.push(n); }
      const c = delta(current.concealedSamples, old.concealedSamples), total = delta(current.totalSamplesReceived, old.totalSamplesReceived);
      if (c !== null && total !== null) { concealed.push(c); totals.push(total); }
      events.push(delta(current.concealmentEvents, old.concealmentEvents));
      const bytes = delta(current.bytesReceived, old.bytesReceived); rates.push(bytes !== null && dt > 0 ? bytes * 8 / dt : null);
    }
    this.previous = next;
    sample.inboundPacketLossPct = ratio(sum(lossNumerators), sum(lossDenominators), 100);
    sample.recoveredPackets = sum(recovered);
    const jitterDelay = sum(delay), jitterCount = sum(emitted); sample.jitterBufferMs = jitterDelay !== null && jitterCount !== null && jitterCount > 0 ? jitterDelay / jitterCount * 1000 : null;
    sample.concealmentPct = ratio(sum(concealed), sum(totals), 100); sample.concealmentEvents = sum(events); sample.inboundKbps = sum(rates); sample.playoutSynthesizedMs = sum(playout);
    const remoteAudio = rows.filter(r => r.type === 'remote-inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio'));
    sample.upstreamRttMs = mean(remoteAudio.map(r => ms(r.roundTripTime)));
    sample.upstreamPacketLossPct = mean(remoteAudio.map(r => { const fraction = finite(r.fractionLost); return fraction !== null && fraction >= 0 && fraction <= 1 ? fraction * 100 : null; }));
    this.samples.push(sample); this.samples = this.samples.slice(-LIMIT); return { ...sample };
  }
  summary(): LivePerformanceSummary { return summarize(this.samples.map(s => ({ ...s })), this.events); }
  report(): LivePerformanceReport { const samples = this.samples.map(s => ({ ...s })), events = this.events.map(e => ({ ...e })); return { schemaVersion: 1, provider: this.provider, transport: this.transport, ...(this.model ? { model: this.model } : {}), startedAt: this.startedAtISO, strategy: this.label, durationMs: this.elapsed(), samples, events, summary: summarize(samples, events), caveats: [...CAVEATS] }; }
}

/** Persist/export only the same strict allowlist, even if storage contains a modified payload. */
function sanitizedReport(value: unknown): LivePerformanceReport | null {
  const r = record(value); if (!r || r.schemaVersion !== 1 || !Array.isArray(r.samples) || !Array.isArray(r.events)) return null;
  const samples = r.samples.slice(-LIMIT).map(value => {
    const row = record(value); if (!row || nonnegative(row.atMs) === null) return null;
    const sample = emptySample(row.atMs as number, strategy(row.strategy));
    for (const key of NUMERIC_SAMPLE_KEYS) sample[key] = key === 'inboundPacketsLost' ? finite(row[key]) : nonnegative(row[key]);
    if (row.route === 'relay' || row.route === 'direct') sample.route = row.route;
    if (row.protocol === 'udp' || row.protocol === 'tcp') sample.protocol = row.protocol;
    return sample;
  }).filter((v): v is LivePerformanceSample => v !== null);
  const events = r.events.slice(-LIMIT).map(value => {
    const row = record(value); if (!row || nonnegative(row.atMs) === null) return null;
    const common = { atMs: row.atMs as number, strategy: strategy(row.strategy) };
    if (row.type === 'measure' && typeof row.name === 'string' && MEASURES.has(row.name) && nonnegative(row.durationMs) !== null) return { ...common, type: 'measure' as const, name: row.name as PerformanceMeasureName, durationMs: row.durationMs as number };
    if (row.type === 'user_stutter' || row.type === 'strategy_change') return { ...common, type: row.type };
    return null;
  }).filter((v): v is LivePerformanceEvent => v !== null);
  return { schemaVersion: 1, provider: voiceProvider(r.provider), transport: r.transport === 'websocket_relay' ? 'websocket_relay' : 'webrtc_direct', ...(safeModel(r.model) ? { model: safeModel(r.model) } : {}), startedAt: isoDate(r.startedAt), strategy: strategy(r.strategy), durationMs: nonnegative(r.durationMs) ?? 0, samples, events, summary: summarize(samples, events), caveats: [...CAVEATS] };
}
export function performanceReportJSON(report: LivePerformanceReport) { return JSON.stringify(sanitizedReport(report), null, 2); }
export function performanceReportCSV(report: LivePerformanceReport) {
  const safe = sanitizedReport(report); if (!safe) return '';
  const keys = ['rttMs', 'inboundJitterMs', 'jitterBufferMs', 'inboundPacketLossPct', 'concealmentPct', 'concealmentEvents', 'inboundKbps', 'upstreamPacketLossPct', 'upstreamRttMs', 'playoutSynthesizedMs', 'inboundPacketsReceived', 'inboundPacketsLost', 'recoveredPackets', 'intervalMs', 'route', 'protocol'] as const;
  const rows = [['record_type', 'started_at_utc', 'at_ms', 'strategy', 'name', 'duration_ms', 'provider', 'transport', 'model', ...keys], ...safe.samples.map(s => ['sample', safe.startedAt, s.atMs, s.strategy, '', '', safe.provider || 'openai', safe.transport || 'webrtc_direct', safe.model || '', ...keys.map(k => s[k] ?? '')]), ...safe.events.map(e => [e.type, safe.startedAt, e.atMs, e.strategy, e.type === 'measure' ? e.name : '', e.type === 'measure' ? e.durationMs : '', safe.provider || 'openai', safe.transport || 'webrtc_direct', safe.model || '', ...keys.map(() => '')])];
  return rows.map(row => row.join(',')).join('\n');
}
export type PerformanceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function storageOrDefault(storage?: PerformanceStorage): PerformanceStorage | null { if (storage) return storage; try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
export function loadPerformanceReports(storage?: PerformanceStorage): LivePerformanceReport[] {
  try { const raw = storageOrDefault(storage)?.getItem(STORAGE_KEY); const values: unknown = raw ? JSON.parse(raw) : []; return Array.isArray(values) ? values.slice(0, 3).map(sanitizedReport).filter((r): r is LivePerformanceReport => r !== null) : []; } catch { return []; }
}
export function savePerformanceReport(report: LivePerformanceReport, storage?: PerformanceStorage): boolean {
  try { const target = storageOrDefault(storage), safe = sanitizedReport(report); if (!target || !safe) return false; target.setItem(STORAGE_KEY, JSON.stringify([safe, ...loadPerformanceReports(target).filter(previous => previous.startedAt !== safe.startedAt)].slice(0, 3))); return true; } catch { return false; }
}
export function clearPerformanceReports(storage?: PerformanceStorage): boolean { try { const target = storageOrDefault(storage); if (!target) return false; target.removeItem(STORAGE_KEY); return true; } catch { return false; } }
