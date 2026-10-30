import { api } from './browser-speech';
import { DomesticVoiceTransport } from './domestic-voice-transport';
import { type VoiceProviderId, VOICE_PROVIDERS } from './voice-provider';
import { compactContext, type LiveContext, type LiveMode, type LiveSession, type LiveState, type LiveToolCall } from './live-protocol';
import { agentResultSchema, agentTool, contextChunks, spokenUpdate, type LiveAgentResult, type LiveTranscript } from './live-agent';
import { describeUI, requestedObjects, requestsDrawing } from './live-ui';
import type { LiveTrace } from './live-diagnostics';
import { LessonCoach, coachPrompt, coachControl } from './lesson-coach';
import { LivePerformanceCollector, savePerformanceReport, type LivePerformanceSummary, type PerformanceMeasureName } from './live-performance';
import type { ServerPerformance } from './server-timing';

type EventData = { type?: string; event_id?: string; client_event_id?: string; delta?: string; start_ms?: number; end_ms?: number; offset_ms?: number; delegation?: { id?: string; target?: string }; usage?: { seconds?: number }; reason?: string; error?: { code?: string }; tool?: { callId: string; name: string; arguments: string } };
export type LiveCallbacks = {
  state: (state: LiveState) => void;
  transcript?: (role: 'child' | 'teacher', delta: string) => void;
  usage?: (seconds: number) => void;
  error?: (message: string) => void;
  tool?: (call: LiveToolCall) => Promise<unknown>;
  activity?: (message: string) => void;
  sync?: (state: 'pending' | 'confirmed') => void;
  level?: (level: number) => void;
  advance?: () => boolean;
  assistance?: () => void;
  coaching?: (enabled: boolean) => void;
  performance?: (summary: LivePerformanceSummary) => void;
};
export type LiveDependencies = {
  peer: () => RTCPeerConnection;
  media: () => Promise<MediaStream>;
  audio: () => HTMLAudioElement;
  request: <T>(path: string, body: unknown) => Promise<T>;
  closeWaitMs?: number;
  now: () => number;
  commandWaitMs?: number;
};
function defaults(): LiveDependencies {
  return { now: () => performance.now(), peer: () => { if (typeof RTCPeerConnection === 'undefined') throw new Error('当前浏览器不支持实时语音，可以继续用文字和圈画。'); return new RTCPeerConnection(); }, media: () => { if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法打开麦克风，请使用 HTTPS 页面或改用文字回答。'); return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); }, audio: () => { const audio = document.createElement('audio'); audio.autoplay = true; return audio; }, request: <T>(path: string, body: unknown) => api<T>(path, body, AbortSignal.timeout(path === '/api/live/agent' ? 25_000 : 40_000)) };
}

/** Owns one billed connection. No API credentials, recordings, or automated retries. */
export class LiveClassroomClient {
  private peer: RTCPeerConnection | null = null;
  private domestic: DomesticVoiceTransport | null = null;
  private nativeTools = new Set<string>();
  private channel: RTCDataChannel | null = null;
  private media: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private session: LiveSession | null = null;
  private state: LiveState = 'idle';
  private stopped = false;
  private closedConfirmed = false;
  private closeResolve: (() => void) | null = null;
  private closePromise: Promise<void> | null = null;
  private callbacks: LiveCallbacks;
  private deps: LiveDependencies;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private startup: ReturnType<typeof setTimeout> | null = null;
  private seenEvents = new Set<string>();
  private delegations = new Set<string>();
  private eventCounter = 0;
  private agentQueue: Promise<void> = Promise.resolve();
  private pendingAgents = 0;
  private lastContext = '';
  private context?: LiveContext;
  private contextVersion = 0;
  private history: LiveTranscript[] = [];
  private speech: LiveTranscript[] = [];
  private lastChildAt = -Infinity;
  private speechStartedAt = 0;
  private lastAttentionAt = -Infinity;
  private lastRedirectAt = -Infinity;
  private attentionPending = false;
  private attentionEpoch = 0;
  private muted = false;
  private connectedAt = 0;
  private voiceText = '';
  private voiceAt = -Infinity;
  private commandTimer: ReturnType<typeof setTimeout> | null = null;
  private handledDrawing = new Map<string, { id: string | null; confirmed: boolean; at: number }>();
  private traceEvents: LiveTrace[] = [];
  private traceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTranscriptTrace = -Infinity;
  private stateAppends = new Set<string>();
  private audioContext: AudioContext | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private inputLevelTimer: ReturnType<typeof setInterval> | null = null;
  private coachTimer: ReturnType<typeof setInterval> | null = null;
  private coach = new LessonCoach();
  private teacherAudible = false;
  private teacherEnergyAt = -Infinity;
  private pendingDrawing = 0;
  private perf: LivePerformanceCollector;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private statsBusy = false;
  private contextSentAt = new Map<string, number>();
  private startedAt = 0;
  private firstTeacher = false;
  private pendingControlAt: number | null = null;
  private childEnergyAt = -Infinity;
  private childEnergySince = 0;
  private pendingChild = false;
  private childOverlapped = false;
  private lastSavedAt = 0;
  constructor(callbacks: LiveCallbacks, dependencies?: Partial<LiveDependencies>, private provider: VoiceProviderId = 'openai') { this.callbacks = callbacks; this.deps = { ...defaults(), ...dependencies }; this.perf = new LivePerformanceCollector({ now: this.deps.now, provider: this.provider, transport: VOICE_PROVIDERS[this.provider].transport }); }
  performanceReport() { return this.perf.report(); }
  setStrategy(label: string) { this.perf.setStrategy(label); this.publishPerformance(); }
  markStutter() { this.perf.markUserStutter(); this.trace('user_stutter'); this.publishPerformance(); }
  private publishPerformance() { this.callbacks.performance?.(this.perf.summary()); }
  private serverPerformance(raw: unknown, scope: 'session' | 'agent' | 'vision') {
    const data = (raw as { performance?: ServerPerformance } | null)?.performance;
    if (!data) return;
    if (scope === 'session') this.perf.setModel(data.model);
    this.perf.measure(`${scope}_server_total`, data.serverTotalMs); this.perf.measure(`${scope}_upstream`, data.upstreamMs);
  }
  private async measuredRequest<T>(path: string, body: unknown, name: PerformanceMeasureName): Promise<T> {
    const began = this.deps.now();
    try { return await this.deps.request<T>(path, body); }
    finally { const durationMs = this.deps.now() - began; this.perf.measure(name, durationMs); this.trace('latency_sample', { code: name, durationMs }); this.publishPerformance(); }
  }
  private async executeTool(call: LiveToolCall) {
    const began = this.deps.now();
    try {
      const output = await this.callbacks.tool?.(call);
      this.serverPerformance(output, 'vision');
      const httpMs = (output as { performance?: { clientHttpMs?: number } } | null)?.performance?.clientHttpMs;
      if (typeof httpMs === 'number') this.perf.measure('vision_http', httpMs);
      return output;
    } finally { this.perf.measure('tool_total', this.deps.now() - began); this.publishPerformance(); }
  }
  private async samplePerformance() {
    const peer = this.domestic || this.peer;
    if (!peer || this.statsBusy || this.stopped || typeof peer.getStats !== 'function') return;
    this.statsBusy = true;
    try {
      const stats = await peer.getStats();
      if (this.stopped || this.peer !== peer) return;
      const sample = this.perf.sample(stats.values()); this.publishPerformance();
      if (this.deps.now() - this.lastSavedAt > 10_000) {
        const optional = (value: number | null) => value == null ? undefined : value;
        this.trace('rtc_sample', { rttMs: optional(sample.rttMs), jitterMs: optional(sample.inboundJitterMs), jitterBufferMs: optional(sample.jitterBufferMs), lossPct: optional(sample.inboundPacketLossPct), concealmentPct: optional(sample.concealmentPct) });
        savePerformanceReport(this.perf.report()); this.lastSavedAt = this.deps.now();
      }
    } catch { /* Unsupported statistics remain unavailable, never zero-filled. */ }
    finally { this.statsBusy = false; }
  }
  private change(state: LiveState) { this.state = state; this.callbacks.state(state); }
  private emit(event: object) {
    if (this.channel?.readyState !== 'open') return false;
    try { const id = `leaf_${++this.eventCounter}`; this.channel.send(JSON.stringify({ event_id: id, ...event })); return id; }
    catch { this.callbacks.error?.('实时数据通道暂时不可用，请结束后重新连接。'); return false; }
  }
  private append(kind: 'thinking' | 'commentary' | 'instructions', content: string, delegationId: string | null = null, stateUpdate = false) {
    // Context can be chunked; spoken updates remain a single coherent reminder.
    const chunks = kind === 'thinking' ? contextChunks(content) : [spokenUpdate(content)];
    for (const chunk of chunks) { const id = this.emit({ type: `session.${kind}.append`, delegation_id: delegationId, content: chunk }); if (stateUpdate && id) { this.stateAppends.add(id); this.contextSentAt.set(id, this.deps.now()); } if (kind === 'commentary' && id) { this.coach.speechRequested(this.deps.now()); this.pendingChild = false; if (!this.teacherAudible) this.pendingControlAt ??= this.deps.now(); } }
  }
  private trace(type: LiveTrace['type'], fields: Omit<LiveTrace, 'at' | 'type'> = {}) {
    if (!this.session || !this.context) return;
    this.traceEvents.push({ at: Math.max(0, this.deps.now() - this.connectedAt), type, ...fields }); this.traceEvents = this.traceEvents.slice(-20);
    if (!this.traceTimer) this.traceTimer = setTimeout(() => { this.traceTimer = null; this.flushTrace(); }, 1500);
  }
  private flushTrace() {
    if (this.traceTimer) clearTimeout(this.traceTimer); this.traceTimer = null;
    if (this.domestic || !this.session || !this.traceEvents.length) return;
    const { sessionId, closeToken } = this.session;
    void this.deps.request('/api/live/diagnostics', { sessionId, closeToken, events: this.traceEvents.splice(0, 20) }).catch(() => {});
  }
  private watchAudio(stream: MediaStream, role: 'teacher' | 'child' = 'teacher') {
    if (!this.audioContext) return;
    try {
      const analyser = this.audioContext.createAnalyser(); analyser.fftSize = 256;
      this.audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const timer = setInterval(() => {
        if (this.audioContext?.state !== 'running') return;
        analyser.getByteTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
        const audible = role === 'child' ? (this.muted ? 0 : rms) : (this.audio?.paused ? 0 : rms);
        this.observeAudio(role, audible);
        if (role === 'teacher') this.callbacks.level?.(Math.min(1, audible * 9));
      }, 80);
      if (role === 'teacher') this.levelTimer = timer; else this.inputLevelTimer = timer;
      void this.audioContext.resume().catch(() => {});
    } catch { /* Avatar animation is optional; audio playback remains independent. */ }
  }
  /** The transport feeds measured energy here; it does not retain or upload samples. */
  observeAudio(role: 'teacher' | 'child', level: number) {
    const now = this.deps.now(); this.coach.media(role, level, now);
    if (role === 'child' && !this.muted && level >= .02) {
      if (now - this.childEnergyAt > 400) { this.childEnergySince = now; this.childOverlapped = this.teacherAudible; }
      if (this.teacherAudible) this.childOverlapped = true;
      this.childEnergyAt = now; if (now - this.childEnergySince >= 160) this.pendingChild = true;
    }
    if (role === 'teacher') {
      const audible = level >= .006;
      if (audible) this.teacherEnergyAt = this.deps.now();
      if (audible && !this.teacherAudible) {
        this.teacherAudible = true; this.trace('teacher_audio_started');
        if (!this.firstTeacher) { this.firstTeacher = true; this.perf.measure('first_teacher_audio', now - this.startedAt); }
        if (this.pendingControlAt !== null) { this.perf.measure('control_to_audio', now - this.pendingControlAt); this.pendingControlAt = null; }
        if (this.pendingChild && !this.childOverlapped && now - this.childEnergyAt >= 300 && now - this.childEnergyAt <= 30_000) this.perf.measure('child_to_teacher_gap', now - this.childEnergyAt);
        this.pendingChild = false; this.publishPerformance();
      }
      else if (!audible && this.teacherAudible && this.deps.now() - this.teacherEnergyAt > 600) { this.teacherAudible = false; this.trace('teacher_audio_stopped'); }
    }
  }
  coachTick() {
    if (this.state !== 'connected' || this.stopped || !this.context) return;
    const action = this.coach.tick(this.deps.now(), this.muted || this.pendingAgents > 0 || this.pendingDrawing > 0 || this.attentionPending || this.stateAppends.size > 0 || Boolean(this.audio?.paused));
    if (!action) return;
    if (action.type === 'missing_audio') { this.trace('coach_no_audio'); this.callbacks.activity?.('老师的声音尚未确认播放，请点「声音」检查'); return; }
    if (action.type === 'advance') {
      const accepted = this.callbacks.advance?.(); this.trace('coach_advance', { code: accepted ? 'confirmed' : 'unavailable' });
      if (!accepted) this.callbacks.activity?.('这一步已完成，点击继续进入下一题');
      return;
    }
    this.trace('coach_nudge', { count: action.stage }); this.callbacks.assistance?.();
    this.callbacks.activity?.(action.stage === 1 ? '老师换一种问法，引导你开始' : action.stage === 2 ? '老师给出提示，降低一点难度' : '老师先做示范，再请你试一次');
    this.append('thinking', `Verified coaching facts: ${JSON.stringify({ prompt: this.context.step.english, hint: this.context.step.hint, expected: this.context.step.expected, selectedIds: this.context.selectedIds, stage: action.stage, neverCreditSilence: true })}`);
    this.append('commentary', this.provider === 'doubao' ? (action.stage === 1 ? this.context.step.english : action.stage === 2 ? this.context.step.hint : `Listen: ${this.context.step.expected || this.context.step.english}. Now it is your turn.`) : coachPrompt(this.context, action.stage));
  }
  setCoaching(value: boolean) { this.coach.setEnabled(value, this.deps.now()); this.callbacks.coaching?.(value); this.trace('coach_suspended', { code: value ? 'resumed' : 'disabled' }); }
  async start(mode: LiveMode, context?: LiveContext) {
    if (!['idle','closed','error'].includes(this.state)) return;
    this.stopped = false; this.closedConfirmed = false; this.closePromise = null; this.change('connecting');
    this.perf = new LivePerformanceCollector({ now: this.deps.now, provider: this.provider, transport: VOICE_PROVIDERS[this.provider].transport }); this.startedAt = this.deps.now(); this.firstTeacher = false; this.teacherAudible = false; this.pendingControlAt = null; this.pendingChild = false; this.childEnergyAt = -Infinity; this.lastSavedAt = this.startedAt;
    this.context = context;
    try {
      if (this.provider !== 'openai') {
        this.domestic = new DomesticVoiceTransport(this.provider, {
          event: event => { void this.receive(JSON.stringify(event), mode, context); },
          level: (role, level) => { this.observeAudio(role, level); if (role === 'teacher') this.callbacks.level?.(Math.min(1, level * 9)); },
          error: message => this.callbacks.error?.(message),
          measure: (name, milliseconds) => { this.perf.measure(name, milliseconds); this.publishPerformance(); },
        }, { request: this.deps.request, media: this.deps.media, peer: this.deps.peer, audio: this.deps.audio, now: this.deps.now });
        // The adapter presents the same send/close surface; native WebRTC statistics stay separate.
        this.channel = this.domestic.channel as unknown as RTCDataChannel;
        this.session = await this.domestic.start(mode, context);
        this.perf.setModel((this.session as { model?: string }).model); this.publishPerformance();
        if (this.stopped) this.domestic.dispose();
        return;
      }
      this.peer = this.deps.peer();
      this.channel = this.peer.createDataChannel('oai-events');
      this.channel.onmessage = event => { void this.receive(event.data, mode, context); };
      this.channel.onclose = () => { if (!this.closedConfirmed && !this.stopped) { this.callbacks.error?.('实时连接已断开。你的课程进度保留，请点击重新连接。'); void this.stop(); } };
      this.peer.onconnectionstatechange = () => {
        if (this.peer?.connectionState === 'failed' && !this.stopped) { this.callbacks.error?.('实时网络连接失败，可以继续用文字和圈画练习。'); void this.stop(); }
      };
      if (mode === 'probe') this.peer.addTransceiver('audio', { direction: 'recvonly' });
      else {
        if (!context) throw new Error('缺少当前课堂内容。');
        try { if (typeof AudioContext !== 'undefined') { this.audioContext = new AudioContext(); void this.audioContext.resume().catch(() => {}); } } catch { this.audioContext = null; }
        const microphoneAt = this.deps.now(); this.media = await this.deps.media(); this.perf.measure('microphone_permission', this.deps.now() - microphoneAt);
        if (this.stopped) { this.media.getTracks().forEach(track => track.stop()); this.release(); return; }
        for (const track of this.media.getAudioTracks()) this.peer.addTrack(track, this.media);
        this.watchAudio(this.media, 'child');
        this.audio = this.deps.audio();
        this.peer.ontrack = event => {
          if (!this.audio || this.stopped) return;
          const remote = event.streams[0] || new MediaStream([event.track]); this.audio.srcObject = remote; this.watchAudio(remote);
          void this.audio.play().catch(() => this.callbacks.error?.('声音被浏览器暂停了，请点击「播放老师声音」。'));
        };
      }
      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      const iceAt = this.deps.now(); await this.waitForIce(); this.perf.measure('ice_gathering', this.deps.now() - iceAt);
      if (this.stopped) { this.release(); return; }
      const sdp = this.peer.localDescription?.sdp;
      if (!sdp) throw new Error('没有生成完整的 WebRTC 连接信息。');
      // Do not abort/retry creation: a lost HTTP response can still create a billed session.
      this.session = await this.measuredRequest<LiveSession>('/api/live/session', mode === 'probe' ? { mode, sdp } : { mode, sdp, consent: true, context }, 'session_http'); this.serverPerformance(this.session, 'session');
      if (this.stopped) { await this.serverClose(); this.release(); return; }
      this.startup = setTimeout(() => { this.callbacks.error?.('实时课堂连接超时，请检查网络后重新连接。'); void this.stop(); }, 25_000);
      await this.peer.setRemoteDescription({ type: 'answer', sdp: this.session.sdp });
    } catch (error) {
      const cancelled = this.stopped;
      if (!cancelled) this.callbacks.error?.(error instanceof Error && error.name === 'NotAllowedError' ? '麦克风权限未开启，可以使用文字和圈画。' : error instanceof Error ? error.message : '无法连接实时课堂。');
      await this.stop(); if (!cancelled) this.change('error');
    }
  }
  private async waitForIce() {
    const peer = this.peer!;
    if (peer.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', check); peer.removeEventListener('connectionstatechange', check); };
      const check = () => { if (peer.iceGatheringState === 'complete' || peer.connectionState === 'closed') { done(); resolve(); } };
      const timeout = setTimeout(() => { done(); reject(new Error('网络候选地址收集超时，请重新连接。')); }, 10_000);
      peer.addEventListener('icegatheringstatechange', check); peer.addEventListener('connectionstatechange', check); check();
    });
  }
  private async receive(raw: unknown, mode: LiveMode, initial?: LiveContext) {
    let event: EventData;
    try { if (typeof raw !== 'string' || raw.length > 1_000_000) return; event = JSON.parse(raw); } catch { return; }
    if (event.type === 'provider.failed') { this.stopped = true; this.release(); this.change('error'); return; }
    if (event.type === 'provider.tool' && event.tool) { void this.providerTool(event.tool); return; }
    if (event.event_id) { if (this.seenEvents.has(event.event_id)) return; this.seenEvents.add(event.event_id); if (this.seenEvents.size > 2000) this.seenEvents.delete(this.seenEvents.values().next().value!); }
    if (event.type === 'session.closed') {
      this.closedConfirmed = true; this.callbacks.usage?.(event.usage?.seconds || 0); this.closeResolve?.();
      if (!this.stopped) { this.stopped = true; this.release(); this.change('closed'); } return;
    }
    if (event.type === 'session.usage.updated') { if (typeof event.usage?.seconds === 'number') this.callbacks.usage?.(event.usage.seconds); return; }
    if (this.stopped) return;
    if (event.type === 'session.started') {
      if (this.startup) clearTimeout(this.startup); this.startup = null; this.change('connected');
      if (mode === 'probe') { void this.stop(); return; }
      this.connectedAt = this.deps.now();
      this.perf.measure('startup_total', this.connectedAt - this.startedAt); this.perf.measure('connection_ready', this.connectedAt - this.startedAt);
      let due = this.deps.now() + 2000;
      this.statsTimer = setInterval(() => { this.perf.measure('event_loop_lag', Math.max(0, this.deps.now() - due)); due = this.deps.now() + 2000; void this.samplePerformance(); }, 2000);
      if (initial) this.coach.reset(initial, this.connectedAt);
      this.trace('connected');
      if (initial) { this.updateContext(initial); this.append('commentary', this.provider === 'doubao' ? initial.step.english : `Start teaching the current task now. Briefly connect the textbook topic to one concrete question or action. Use this task as the objective, not a script to read: ${initial.step.english}`); }
      this.coachTimer = setInterval(() => this.coachTick(), 500);
      this.deadline = setTimeout(() => { this.callbacks.error?.('这次实时对话已满 10 分钟，已结束连接。准备好后可以重新开始。'); void this.stop(); }, 10 * 60_000);
    } else if (event.type === 'session.input_transcript.delta' && event.delta) this.transcript('child', event);
    else if (event.type === 'session.output_transcript.delta' && event.delta) this.transcript('teacher', event);
    else if (event.type === 'session.thinking.appended' && event.client_event_id && this.stateAppends.delete(event.client_event_id)) { const sentAt = this.contextSentAt.get(event.client_event_id); if (sentAt !== undefined) this.perf.measure('context_injection', this.deps.now() - sentAt); this.contextSentAt.delete(event.client_event_id); this.trace('context_acked', { count: this.stateAppends.size }); if (!this.stateAppends.size) this.callbacks.sync?.('confirmed'); }
    else if (event.type === 'error') { this.trace('provider_error', { code: (event.error?.code || 'unknown').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0,80) }); this.callbacks.error?.('老师没有完成刚才的实时操作，请再说一次；必要时结束后重新连接。'); }
    else if (event.type === 'session.delegation.created' && event.delegation?.target === 'client' && event.delegation.id) {
      const id = event.delegation.id;
      if (this.delegations.has(id)) return;
      this.delegations.add(id);
      this.trace('delegation');
      this.append('thinking', '', id); // Cancel the pending automatic acknowledgement before doing any work.
      if (!this.drawingCommand(this.voiceText, id)) this.enqueueAgent('delegation', id);
    }
  }
  private async providerTool(call: { callId: string; name: string; arguments: string }) {
    if (!this.domestic || this.stopped || !this.context || this.nativeTools.has(call.callId)) return;
    this.nativeTools.add(call.callId); if (this.nativeTools.size > 200) this.nativeTools.delete(this.nativeTools.values().next().value!);
    const version = this.contextVersion;
    let output: unknown = { status: 'failed', error: 'Invalid or obsolete classroom tool.' };
    try {
      const args = JSON.parse(call.arguments);
      if (args.contextKey === this.context.contextKey && ['highlight_objects','submit_spoken_answer','inspect_current_page'].includes(call.name)) {
        this.pendingDrawing++;
        output = await this.executeTool({ call_id: call.callId, name: call.name, arguments: call.arguments });
      }
    } catch { /* Tool failures are returned as failures, never announced as successful. */ }
    finally { this.pendingDrawing = Math.max(0, this.pendingDrawing - 1); }
    if (this.stopped || version !== this.contextVersion) output = { status: 'failed', error: 'Task changed; discard old result.' };
    if (!this.stopped) this.emit({ type: 'provider.tool_result', callId: call.callId, output: JSON.stringify(output || { status: 'failed' }) });
  }
  private transcript(role: 'child' | 'teacher', event: EventData) {
    const text = event.delta!.slice(0, 600), fallback = Math.max(0, this.deps.now() - this.connectedAt);
    const entry: LiveTranscript = { role, text, startMs: Math.max(0, event.start_ms ?? fallback), endMs: Math.max(0, event.end_ms ?? fallback) };
    this.history.push(entry); this.history = this.history.slice(-64);
    this.callbacks.transcript?.(role, event.delta!);
    this.coach.activity(this.deps.now(), role === 'child');
    if (role !== 'child' || this.muted) return;
    const now = this.deps.now();
    if (now - this.lastTranscriptTrace > 30_000) { this.trace('input_transcript'); this.lastTranscriptTrace = now; }
    if (now - this.voiceAt > 2500) this.voiceText = '';
    this.voiceAt = now; this.voiceText = (this.voiceText + event.delta!).slice(-1000);
    if (coachControl(this.voiceText) === 'pause') this.setCoaching(false);
    else if (coachControl(this.voiceText) === 'wait') this.coach.hold(now);
    if (this.commandTimer) clearTimeout(this.commandTimer);
    if (requestsDrawing(this.voiceText)) { const text = this.voiceText, version = this.contextVersion; this.commandTimer = setTimeout(() => { this.commandTimer = null; if (this.stopped || version !== this.contextVersion || this.muted) return; if (!this.drawingCommand(text, null) && !this.pendingAgents && !this.domestic) this.enqueueAgent('typed', null, text); }, this.deps.commandWaitMs ?? 700); }
    // A gap resets the attention window, never marks an answer complete.
    if (now - this.lastChildAt > 3000) { this.speechStartedAt = now; this.speech = []; this.attentionEpoch++; }
    this.lastChildAt = now; this.speech.push(entry); this.speech = this.speech.slice(-64);
    if (/\b(stop|wait|help|pause|finish|goodbye)\b|等等|停一下|暂停|不懂|不会|帮我|再见|结束|难受|害怕/i.test(this.speech.slice(-4).map(x => x.text).join(''))) { this.attentionEpoch++; this.lastAttentionAt = now; return; }
    if (this.domestic) return; // Native provider policies handle barge-in; no hidden OpenAI reasoning request.
    if (now - this.speechStartedAt < 10_000 || this.speech.map(x => x.text).join('').trim().length < 30 || now - this.lastAttentionAt < 8000 || now - this.lastRedirectAt < 20_000 || this.attentionPending || this.pendingAgents) return;
    this.lastAttentionAt = now; this.attentionPending = true;
    void this.runAgent('attention', null, undefined, [...this.speech]).finally(() => { this.attentionPending = false; });
  }
  private drawingCommand(text: string, id: string | null) {
    const context = this.context;
    if (!context || this.stopped) return false;
    const ids = requestedObjects(text, context); if (!ids.length) return false;
    const key = `${context.contextKey}:${context.annotations?.revision || 0}:${text.toLowerCase().trim()}`;
    const existing = this.handledDrawing.get(key);
    if (existing && this.deps.now() - existing.at < 12_000) { if (id) { existing.id = id; this.append('thinking', existing.confirmed ? 'The application already drew the requested circle. Do not run it twice or claim inability to act.' : 'The application is drawing the requested circle. Wait for its confirmation.', id); } return true; }
    const record = { id, confirmed: false, at: this.deps.now() }; this.handledDrawing.set(key, record);
    if (this.handledDrawing.size > 20) this.handledDrawing.delete(this.handledDrawing.keys().next().value!);
    this.trace('drawing_request', { count: ids.length }); this.callbacks.activity?.('老师正在教材上画圈…');
    const version = this.contextVersion;
    this.pendingDrawing++;
    void (async () => {
      try {
        const output = await this.executeTool({ call_id: `drawing_${++this.eventCounter}`, name: 'highlight_objects', arguments: JSON.stringify({ contextKey: context.contextKey, objectIds: ids }) }) as { status?: string } | undefined;
        if (this.stopped || version !== this.contextVersion) return;
        if (output?.status !== 'confirmed') { this.trace('tool_rejected'); this.append('thinking', 'The circle could not be confirmed. Do not claim success.', record.id); this.callbacks.activity?.('画圈还未完成，请重试'); return; }
        record.confirmed = true; const names = ids.map(objectId => context.objects.find(o => o.id === objectId)!.label).join(', ');
        this.trace('tool_confirmed', { count: ids.length }); this.callbacks.activity?.(`老师已画好圈`);
        this.append('instructions', 'The application has confirmed the requested circle is drawn on the page. You can operate this page through the application. Do not say you cannot see or interact with it. Use confirmed UI facts; inspect only unknown marks.', record.id);
        this.append('commentary', this.provider === 'doubao' ? `I have circled ${names}. ${context.step.english}` : `The application confirms a visible circle is now drawn around ${names}. Tell the learner briefly, then stay on the current task.`, record.id);
      } catch { this.trace('tool_rejected'); this.callbacks.activity?.('画圈暂时没有完成'); }
      finally { this.pendingDrawing--; }
    })();
    return true;
  }
  private enqueueAgent(reason: 'delegation' | 'typed', id: string | null, message?: string) {
    const version = this.contextVersion;
    const queuedAt = this.deps.now();
    this.pendingAgents++;
    this.agentQueue = this.agentQueue.then(async () => {
      if (version !== this.contextVersion || this.stopped) { if (!this.stopped && id) this.append('thinking', 'The task changed. Discard this old request.', id); return; }
      this.perf.measure('agent_queue', this.deps.now() - queuedAt);
      await this.runAgent(reason, id, message);
    }).finally(() => { this.pendingAgents--; });
  }
  private async runAgent(reason: 'delegation' | 'attention' | 'typed', id: string | null, message?: string, history = [...this.history]) {
    const context = this.context, session = this.session, version = this.contextVersion, attentionEpoch = this.attentionEpoch;
    if (!context || !session || this.stopped) return;
    const current = () => !this.stopped && version === this.contextVersion;
    try {
      if (reason !== 'attention') this.callbacks.activity?.('老师正在查看课堂信息…');
      this.trace('agent_started');
      const raw = await this.measuredRequest<LiveAgentResult>('/api/live/agent', { ...session, sdp: undefined, context, history, reason, ...(message ? { message } : {}) }, 'agent_http'); this.serverPerformance(raw, 'agent');
      if (reason === 'attention' && (this.muted || attentionEpoch !== this.attentionEpoch || this.deps.now() - this.lastChildAt > 3000)) return;
      if (!current() || raw.contextKey !== context.contextKey) { if (!this.stopped && id) this.append('thinking', 'This result is obsolete. Use the newest classroom state.', id); return; }
      const result: LiveAgentResult = { ...agentResultSchema.parse(raw), contextKey: raw.contextKey };
      this.trace('agent_completed', { code: result.action.type });
      if (result.decision === 'wait') { if (id) this.append('thinking', 'No verified result yet. Let the child continue or ask one short clarification; do not grade a fragment.', id); return; }
      if (result.decision === 'redirect') { this.redirect(result.english, id); return; }
      // A mid-speech check may only redirect or wait, never execute an action or grade.
      if (reason === 'attention') return;
      const tool = agentTool(result, context, id || `typed_${++this.eventCounter}`);
      if (result.action.type !== 'none' && !tool) { this.append('thinking', 'The requested classroom action was rejected. Do not claim it happened.', id); return; }
      if (tool) {
        const output = await this.executeTool(tool) as { status?: string; assessment?: string; english?: string; highlighted?: string[] } | undefined;
        if (!current()) return;
        if (output?.status !== 'confirmed') { this.append('commentary', 'The classroom check did not finish. Ask the learner to try again. Do not claim correctness or an action.', id); return; }
        let spoken = output.english;
        if (!spoken && tool.name === 'highlight_objects') spoken = `The application confirms these objects are now highlighted: ${output.highlighted?.join(', ') || context.objects.filter(o => result.action.objectIds.includes(o.id)).map(o => o.label).join(', ')}. Explain briefly, then return to the current task.`;
        if (!spoken && tool.name === 'submit_spoken_answer') spoken = output.assessment === 'correct' || output.assessment === 'already_correct' ? 'The application confirmed the answer is correct. Give one content-specific observation or follow-up, then listen. The application controls the next task.' : 'The answer has not been confirmed correct. Give one short hint and stay on the same task.';
        this.append('commentary', spoken || 'The classroom action completed. Return to the current task.', id);
      } else if (result.english) this.append('commentary', result.english, id);
    } catch {
      this.trace('agent_failed');
      if (current() && reason !== 'attention') { this.callbacks.error?.('老师的后台检查暂时没有完成，可以再说一次或继续圈画。'); this.append('thinking', 'The backend request failed. Do not guess a result or claim an action.', id); }
    } finally { if (current() && reason !== 'attention') this.callbacks.activity?.(''); }
  }
  private redirect(english?: string, id: string | null = null) {
    if (this.stopped || !this.context || this.deps.now() - this.lastRedirectAt < 20_000) return;
    this.lastRedirectAt = this.deps.now();
    this.append('instructions', 'For this one reminder, gently take the floor NOW even if the learner is still speaking. Give one brief redirect to the current task, then listen again. Stop/wait, distress, a meaningful correction or a request to end overrides this reminder.', id);
    this.append('commentary', english || `Let's come back to our picture. ${this.context.step.english}`, id);
    this.callbacks.activity?.('老师正在带回当前练习');
  }
  refocus() { if (this.state === 'connected' && !this.stopped) this.redirect(); }
  updateContext(context: LiveContext) {
    if (this.state !== 'connected' || this.stopped) return;
    this.domestic?.setContext(context);
    const next = compactContext(context); if (next === this.lastContext) return;
    const previousContext = this.lastContext ? this.context : undefined;
    const changedByLearner = !this.context || this.context.contextKey !== context.contextKey || this.context.answered !== context.answered || JSON.stringify(this.context.selectedIds) !== JSON.stringify(context.selectedIds) || this.context.annotations?.revision !== context.annotations?.revision;
    if (this.context?.contextKey !== context.contextKey) this.coach.reset(context, this.deps.now()); else this.coach.update(context, this.deps.now(), changedByLearner);
    this.lastContext = next; this.context = context; if (changedByLearner) { this.contextVersion++; this.voiceText = ''; if (this.commandTimer) clearTimeout(this.commandTimer); }
    this.speech = []; this.lastChildAt = -Infinity; this.callbacks.activity?.('');
    // Send immediately: a second rapid change must not cancel an unsent state patch.
    this.stateAppends.clear(); this.contextSentAt.clear(); this.callbacks.sync?.('pending');
    this.trace('context_sent', { revision: context.annotations?.revision || 0, count: context.annotations?.markCount || 0 });
    if (this.domestic) { this.append('thinking', `Current verified state: ${next}`, null, true); return; }
    for (const fact of describeUI(context, previousContext)) this.append('thinking', `Verified application UI state (reference data): ${fact}`, null, true);
  }
  speak(content: string) { if (this.state === 'connected' && !this.stopped) this.append('commentary', content.slice(0,1200)); }
  instruct(content: string) { if (this.state === 'connected' && !this.stopped) this.append('instructions', content.slice(0,1200)); }
  learnerActivity() { this.coach.activity(this.deps.now(), true); }
  sendTyped(text: string) { if (this.state !== 'connected' || this.stopped || !text.trim()) return false; this.learnerActivity(); const message = text.slice(0,1000); if (coachControl(message) === 'pause') this.setCoaching(false); else if (coachControl(message) === 'wait') this.coach.hold(this.deps.now()); this.append('thinking', `The learner typed this message (reference data): ${message}`); if (!this.drawingCommand(message, null)) { if (this.domestic) this.emit({ type: 'provider.user_text', text: message }); else this.enqueueAgent('typed', null, message); } return true; }
  mute(value: boolean) { this.muted = value; this.learnerActivity(); this.attentionEpoch++; this.speech = []; this.lastChildAt = -Infinity; this.media?.getAudioTracks().forEach(t => { t.enabled = !value; }); this.emit({ type: value ? 'session.input_audio.mute' : 'session.input_audio.unmute' }); }
  play() { this.domestic?.play(); this.coach.setEnabled(this.coach.enabled, this.deps.now()); void this.audioContext?.resume().catch(() => {}); void this.audio?.play().catch(() => this.callbacks.error?.('浏览器未允许播放声音，请检查页面的声音权限。')); }
  private async serverClose() {
    if (this.domestic) { this.domestic.requestClose(); return; }
    if (!this.session) return;
    try { await this.deps.request('/api/live/close', { sessionId: this.session.sessionId, closeToken: this.session.closeToken }); }
    catch { this.callbacks.error?.('会话关闭尚未得到服务端确认，请检查网络连接。'); }
  }
  stop(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.stopped = true; this.change('closing');
    // Stop capture immediately; keep the data channel alive for final usage confirmation.
    this.media?.getTracks().forEach(t => t.stop());
    if (this.deadline) clearTimeout(this.deadline); if (this.startup) clearTimeout(this.startup);
    this.closePromise = (async () => {
      if (!this.closedConfirmed && this.channel?.readyState === 'open' && this.session) {
        await new Promise<void>(resolve => {
          const timeout = setTimeout(resolve, this.deps.closeWaitMs ?? 4500);
          this.closeResolve = () => { clearTimeout(timeout); resolve(); };
          if (!this.emit({ type: 'session.close' })) { clearTimeout(timeout); resolve(); }
        });
      }
      if (!this.closedConfirmed) await this.serverClose();
      this.release(); this.change('closed');
    })();
    return this.closePromise;
  }
  /** Best effort for page teardown; normal stop awaits session.closed. */
  dispose() {
    if (this.domestic) { this.stopped = true; this.domestic.requestClose(); this.release(); return; }
    if (this.session && !this.closedConfirmed) {
      this.emit({ type: 'session.close' });
      void fetch('/api/live/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: this.session.sessionId, closeToken: this.session.closeToken }), keepalive: true }).catch(() => {});
    }
    this.stopped = true; this.release();
  }
  private release() {
    if (this.statsTimer) clearInterval(this.statsTimer); this.statsTimer = null;
    this.perf.finish(); this.publishPerformance(); if (this.context) savePerformanceReport(this.perf.report());
    if (this.coachTimer) clearInterval(this.coachTimer); this.coachTimer = null;
    if (this.inputLevelTimer) clearInterval(this.inputLevelTimer); this.inputLevelTimer = null;
    this.flushTrace(); if (this.commandTimer) clearTimeout(this.commandTimer); if (this.levelTimer) clearInterval(this.levelTimer); this.levelTimer = null;
    void this.audioContext?.close().catch(() => {}); this.audioContext = null; this.callbacks.level?.(0);
    if (this.deadline) clearTimeout(this.deadline); if (this.startup) clearTimeout(this.startup);
    this.media?.getTracks().forEach(t => t.stop()); this.media = null;
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; this.audio = null; }
    this.domestic?.dispose(); this.channel?.close(); this.peer?.close(); this.channel = null; this.peer = null;
  }
}
