import { api } from './browser-speech';
import { type LiveContext, type LiveMode, type LiveSession } from './live-protocol';
import { voiceInstructions, CLASSROOM_VOICE_TOOLS } from './voice-instructions';
import { createQwenProtocol } from './voice-providers/qwen';
import type { DomesticProviderId, VoiceCommand, VoiceEvent } from './voice-providers/types';
import type { PerformanceMeasureName } from './live-performance';
import { PcmVoiceAudio } from './voice-audio';

type WireMessage = Record<string, any>;
export type DomesticSession = LiveSession & { provider: DomesticProviderId; model: string; transport: 'webrtc_direct' | 'websocket_relay'; ticket: string; wsPath?: string; voice?: string; performance?: { serverTotalMs: number; upstreamMs: number; model?: string } };
export type DomesticCallbacks = { event: (event: WireMessage) => void; level: (role: 'child' | 'teacher', level: number) => void; error: (message: string) => void; measure?: (name: PerformanceMeasureName, milliseconds: number) => void };
export type DomesticDependencies = { request: <T>(path: string, body: unknown) => Promise<T>; media: () => Promise<MediaStream>; peer: () => RTCPeerConnection; socket: (url: string) => WebSocket; audio: () => HTMLAudioElement; now: () => number };
const defaults = (): DomesticDependencies => ({ request: (path, body) => api(path, body, AbortSignal.timeout(40_000)), media: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }), peer: () => new RTCPeerConnection(), socket: url => new WebSocket(url), audio: () => { const a = document.createElement('audio'); a.autoplay = true; return a; }, now: () => performance.now() });
export type VoiceEventChannel = { readyState: string; send: (raw: string) => void; close: () => void };
type Queued = { command: VoiceCommand; ackId?: string; supersededAckIds?: string[]; wire?: WireMessage };

/** The long-term provider key stays on the server. This object owns only one media connection. */
export class DomesticVoiceTransport {
  readonly channel: VoiceEventChannel;
  private deps: DomesticDependencies;
  private peer: RTCPeerConnection | null = null;
  private socket: WebSocket | null = null;
  private media: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private analyserContext: AudioContext | null = null;
  private levelTimers: ReturnType<typeof setInterval>[] = [];
  private pcm: PcmVoiceAudio | null = null;
  private eventChannel: RTCDataChannel | null = null;
  private channels = new Set<RTCDataChannel>();
  private seenWireEvents = new Set<string>();
  private sender: RTCRtpSender | null = null;
  private protocol = createQwenProtocol();
  private context?: LiveContext;
  private mode: LiveMode = 'probe';
  private session: DomesticSession | null = null;
  private stopped = false;
  private ready = false;
  private configuredOnce = false;
  private configurationPending = false;
  private queue: Queued[] = [];
  private awaiting: Queued | null = null;
  private facts: string[] = [];
  private transcriptions = new Map<string, string>();
  private transcriptCounter = 0;
  private completedTranscriptions = new Set<string>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingAt = new Map<string, number>();
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private ackTimeout: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly provider: DomesticProviderId, private callbacks: DomesticCallbacks, dependencies?: Partial<DomesticDependencies>) {
    this.deps = { ...defaults(), ...dependencies };
    this.channel = { readyState: 'connecting', send: raw => this.legacy(JSON.parse(raw)), close: () => this.dispose() };
  }
  async start(mode: LiveMode, context?: LiveContext): Promise<DomesticSession> {
    this.mode = mode; this.context = context;
    if (mode === 'classroom' && !context) throw new Error('缺少课堂内容。');
    // The UI checks readiness before capture; the server independently checks configuration and identity.
    if (mode === 'classroom') {
      if (this.provider !== 'qwen') this.pcm = new PcmVoiceAudio({ inputSampleRate: 16000, frameMs: this.provider === 'glm' ? 100 : 20, onFrame: audio => this.sendWire({ type: 'voice.audio', audio }), onLevel: (role, value) => this.callbacks.level(role, value), onQueue: ms => this.callbacks.measure?.('playback_queue', ms), onIssue: message => this.fail(message) });
      const microphoneAt = this.deps.now(); this.media = await this.deps.media(); this.callbacks.measure?.('microphone_permission', this.deps.now() - microphoneAt);
      if (this.stopped) { this.media.getTracks().forEach(track => track.stop()); throw new Error('连接已取消。'); }
    }
    const body: Record<string, unknown> = { provider: this.provider, mode, ...(mode === 'classroom' ? { context, consent: true } : {}) };
    if (this.provider === 'qwen') {
      this.peer = this.deps.peer(); this.sender = this.peer.addTransceiver('audio', { direction: mode === 'probe' ? 'recvonly' : 'sendrecv' }).sender;
      const bind = (channel: RTCDataChannel) => { this.channels.add(channel); channel.onmessage = message => { if (this.stopped) return; try { const wire = JSON.parse(message.data); if (typeof wire.event_id === 'string') { if (this.seenWireEvents.has(wire.event_id)) return; this.seenWireEvents.add(wire.event_id); if (this.seenWireEvents.size > 2000) this.seenWireEvents.delete(this.seenWireEvents.values().next().value!); } } catch { return; } for (const event of this.protocol.parse(message.data)) { if (event.type === 'session_created') this.eventChannel = channel; this.vendorEvent(event); } }; channel.onclose = () => { if (channel === this.eventChannel && !this.stopped) this.fail('实时数据连接已断开，请重新连接。'); }; };
      this.peer.ondatachannel = event => bind(event.channel); bind(this.peer.createDataChannel('oai-events'));
      this.peer.onconnectionstatechange = () => { if (this.peer?.connectionState === 'failed' && !this.stopped) this.fail('实时语音线路连接失败，请重新连接。'); };
      if (mode === 'classroom') {
        this.audio = this.deps.audio(); try { this.analyserContext = new AudioContext(); void this.analyserContext.resume().catch(() => {}); } catch { /* Playback can work without the optional analyser. */ }
        if (this.media) this.watchLevel(this.media, 'child');
        this.peer.ontrack = event => { if (this.stopped || !this.audio) return; const stream = event.streams[0] || new MediaStream([event.track]); this.audio.srcObject = stream; this.watchLevel(stream, 'teacher'); void this.audio.play().catch(() => this.callbacks.error('请点击「声音」允许浏览器播放老师声音。')); };
      }
      const offer = await this.peer.createOffer(); if (this.stopped) throw new Error('连接已取消。'); await this.peer.setLocalDescription(offer); if (this.stopped) throw new Error('连接已取消。'); const iceAt = this.deps.now(); await this.waitForIce(); this.callbacks.measure?.('ice_gathering', this.deps.now() - iceAt); if (this.stopped) throw new Error('连接已取消。');
      body.sdp = this.peer.localDescription?.sdp;
    }
    if (this.stopped) throw new Error('连接已取消。');
    const httpAt = this.deps.now();
    this.session = await this.deps.request<DomesticSession>('/api/voice/session', body);
    this.callbacks.measure?.('session_http', this.deps.now() - httpAt);
    if (this.session.performance) { this.callbacks.measure?.('session_server_total', this.session.performance.serverTotalMs); this.callbacks.measure?.('session_upstream', this.session.performance.upstreamMs); }
    if (this.stopped) { this.dispose(); throw new Error('连接已取消。'); }
    if (this.provider === 'qwen') {
      this.protocol = createQwenProtocol({ model: this.session.model, voice: this.session.voice });
      await this.peer!.setRemoteDescription({ type: 'answer', sdp: this.session.sdp });
    } else {
      const url = new URL(this.session.wsPath || '/api/voice/stream', window.location.href); if (url.origin !== window.location.origin) throw new Error('语音转发地址不属于当前网站。'); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      this.socket = this.deps.socket(url.href);
      this.socket.onopen = () => this.sendWire({ type: 'voice.open', provider: this.provider, sessionId: this.session!.sessionId, ticket: this.session!.ticket, ...(context ? { context } : {}) });
      this.socket.onmessage = event => { if (this.stopped || typeof event.data !== 'string' || event.data.length > 1_000_000) return; try { const value = JSON.parse(event.data); if (value.type === 'voice.pong') { const began = this.pingAt.get(value.id); if (began !== undefined) { this.callbacks.measure?.('websocket_ping', this.deps.now() - began); this.pingAt.delete(value.id); } } else this.vendorEvent(value as VoiceEvent); } catch { this.fail('语音服务返回了无法读取的数据。'); } };
      this.socket.onclose = () => { if (!this.stopped) { this.dispose(); this.callbacks.event({ type: 'session.closed' }); } };
      this.socket.onerror = () => this.fail('语音中转连接失败，请检查网络与服务端配置。');
    }
    if (!this.ready && !this.stopped) this.timeout = setTimeout(() => this.fail('实时语音初始化超时，请检查配置与网络。'), 25_000);
    return this.session;
  }
  private async waitForIce() {
    const peer = this.peer!; if (peer.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve, reject) => { const check = () => { if (peer.iceGatheringState === 'complete' || this.stopped) { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', check); resolve(); } }; const timer = setTimeout(() => { peer.removeEventListener('icegatheringstatechange', check); reject(new Error('网络候选地址收集超时。')); }, 10_000); peer.addEventListener('icegatheringstatechange', check); check(); });
  }
  private watchLevel(stream: MediaStream, role: 'child' | 'teacher') {
    if (!this.analyserContext) return;
    const analyser = this.analyserContext.createAnalyser(); analyser.fftSize = 256; this.analyserContext.createMediaStreamSource(stream).connect(analyser); const values = new Uint8Array(256);
    this.levelTimers.push(setInterval(() => { analyser.getByteTimeDomainData(values); const level = Math.sqrt(values.reduce((a,b) => a + ((b-128)/128)**2,0)/values.length); this.callbacks.level(role, role === 'teacher' && this.audio?.paused ? 0 : level); }, 80));
  }
  private vendorEvent(event: VoiceEvent) {
    if (this.stopped) return;
    if (event.type === 'session_created' && this.provider === 'qwen' && !this.configurationPending) {
      this.configurationPending = true; this.transmit({ command: { type: 'configure', instructions: voiceInstructions(this.context), tools: this.mode === 'classroom' ? CLASSROOM_VOICE_TOOLS : [] } });
    } else if (event.type === 'configured') {
      if (this.ackTimeout) clearTimeout(this.ackTimeout); this.ackTimeout = null;
      const completed = this.awaiting; this.awaiting = null;
      for (const id of [...(completed?.supersededAckIds || []), ...(completed?.ackId ? [completed.ackId] : [])]) this.callbacks.event({ type: 'session.thinking.appended', client_event_id: id });
      if (!this.configuredOnce) { this.configuredOnce = true; void this.activate(); }
      this.pump();
    } else if (event.type === 'transcript') this.transcript(event);
    else if (event.type === 'audio') { if (this.mode === 'classroom') this.pcm?.playChunk(event.audio, event.sampleRate); }
    else if (event.type === 'speech_start') { this.pcm?.cancelPlayback(); this.transcriptCounter++; }
    else if (event.type === 'tool') this.callbacks.event({ type: 'provider.tool', tool: event });
    else if (event.type === 'error') this.fail(event.message || '实时语音服务暂时不可用，请检查配置。');
    else if (event.type === 'closed') { this.dispose(); this.callbacks.event({ type: 'session.closed' }); }
    else if (event.type === 'usage') this.callbacks.event({ type: 'session.usage.updated', usage: { seconds: event.seconds } });
  }
  private async activate() {
    try {
      if (this.mode === 'classroom' && this.media) { if (this.sender && this.provider === 'qwen') await this.sender.replaceTrack(this.media.getAudioTracks()[0]); else await this.pcm?.startCapture(this.media); }
      if (this.stopped) return;
      if (this.timeout) clearTimeout(this.timeout); this.timeout = null;
      this.ready = true; this.channel.readyState = 'open'; this.callbacks.event({ type: 'session.started' });
      if (this.provider !== 'qwen') this.pingTimer = setInterval(() => { const id = String(Math.round(this.deps.now())); this.pingAt.clear(); this.pingAt.set(id, this.deps.now()); this.sendWire({ type: 'voice.ping', id }); }, 5000);
    } catch { this.fail('麦克风音频处理未能启动，请检查浏览器权限。'); }
  }
  private transcript(event: Extract<VoiceEvent, { type: 'transcript' }>) {
    const key = `${event.role}:${event.itemId || this.transcriptCounter}`;
    if (event.role === 'child' && event.final) { const finalKey = key + ':' + event.text; if (this.completedTranscriptions.has(finalKey)) return; this.completedTranscriptions.add(finalKey); if (this.completedTranscriptions.size > 100) this.completedTranscriptions.delete(this.completedTranscriptions.values().next().value!); }
    const previous = this.transcriptions.get(key) || '';
    let delta = event.text;
    if (event.replace || event.final) { if (event.text.startsWith(previous)) delta = event.text.slice(previous.length); else { /* Partial ASR revisions must not be treated as new commands. */ delta = event.final ? event.text : ''; } this.transcriptions.set(key, event.text); }
    else this.transcriptions.set(key, previous + event.text);
    if (this.transcriptions.size > 50) this.transcriptions.delete(this.transcriptions.keys().next().value!);
    // Learner actions run only on final transcription; teacher captions can stream.
    if (event.role === 'child') { if (event.final && event.text.trim()) this.callbacks.event({ type: 'session.input_transcript.delta', delta: event.text, final: true }); }
    else if (delta) this.callbacks.event({ type: 'session.output_transcript.delta', delta });
  }
  setContext(context: LiveContext) { this.context = context; }
  private legacy(event: WireMessage) {
    if (event.type === 'session.close') { this.requestClose(); return; }
    if (this.stopped) return;
    if (event.type === 'session.input_audio.mute' || event.type === 'session.input_audio.unmute') { this.mute(event.type.endsWith('.mute')); return; }
    if (event.type === 'provider.tool_result') { this.enqueue({ command: { type: 'tool_result', callId: event.callId, output: event.output }, wire: { type: 'voice.tool_result', callId: event.callId, output: event.output } }); return; }
    if (event.type === 'provider.user_text') { if (this.provider === 'doubao') { this.callbacks.error('豆包此接口暂不支持文字提问，请用麦克风提问；文字画圈指令仍可使用。'); return; } this.enqueue({ command: { type: 'user_text', text: event.text }, wire: { type: 'voice.text', text: event.text } }); return; }
    if (event.type === 'session.thinking.append' || event.type === 'session.instructions.append') {
      if (event.content) { this.facts.push(String(event.content).slice(0,2000)); this.facts = this.facts.slice(-6); }
      const instructions = voiceInstructions(this.context) + '\nRecent verified application facts (reference data):\n' + this.facts.join('\n');
      this.enqueue({ command: { type: 'context', instructions }, ackId: event.event_id, wire: { type: 'voice.context', context: this.context } });
    } else if (event.type === 'session.commentary.append') { const text = String(event.content || ''); if (text) this.enqueue({ command: { type: 'speak', text }, wire: { type: 'voice.speak', text } }); }
  }
  private enqueue(item: Queued) {
    if (item.command.type === 'context') { const older = this.queue.filter(x => x.command.type === 'context'); this.queue = this.queue.filter(x => x.command.type !== 'context'); item.supersededAckIds = older.flatMap(old => [...(old.supersededAckIds || []), ...(old.ackId ? [old.ackId] : [])]); }
    this.queue.push(item); if (this.queue.length > 30) { this.fail('课堂指令积压，请结束后重新连接。'); return; } this.pump();
  }
  private pump() { if (this.awaiting || this.stopped || !this.configuredOnce) return; const next = this.queue.shift(); if (next) this.transmit(next); }
  private transmit(item: Queued) {
    if (this.provider !== 'qwen') {
      if (item.command.type === 'context') { this.awaiting = item; this.waitForAck(); }
      if (item.wire) this.sendWire(item.wire); if (!this.awaiting) this.pump(); return;
    }
    if (item.wire?.raw && this.eventChannel?.readyState === 'open') { this.eventChannel.send(item.wire.raw); this.pump(); return; }
    const frames = this.protocol.commands(item.command);
    for (let i=0; i<frames.length; i++) {
      const raw = frames[i]; if (typeof raw !== 'string') continue;
      const type = (() => { try { return JSON.parse(raw).type; } catch { return ''; } })();
      if (type === 'session.update') { this.awaiting = item; this.waitForAck(); for (const remaining of frames.slice(i+1).reverse()) this.queue.unshift({ command: { type: 'commit' }, wire: { raw: remaining } }); this.eventChannel?.send(raw); return; }
      if (this.eventChannel?.readyState === 'open') this.eventChannel.send(raw);
    }
    if (!this.awaiting) this.pump();
  }
  private waitForAck() { if (this.ackTimeout) clearTimeout(this.ackTimeout); this.ackTimeout = setTimeout(() => this.fail('教材配置没有得到语音服务确认，请重新连接。'), 15_000); }
  private sendWire(value: object) { if (this.socket?.readyState !== 1 || this.stopped) return; if (this.socket.bufferedAmount > 256_000) { this.fail('上传声音积压，当前线路无法及时传输，请切换网络。'); return; } this.socket.send(JSON.stringify(value)); }
  mute(value: boolean) { this.media?.getAudioTracks().forEach(track => { track.enabled = !value; }); this.pcm?.mute(value); if (this.provider !== 'qwen') this.sendWire({ type: 'voice.mute', muted: value }); }
  play() { void this.analyserContext?.resume().catch(() => {}); this.pcm?.resume(); void this.audio?.play().catch(() => this.callbacks.error('请允许浏览器播放声音。')); }
  getStats() { return this.peer?.getStats() || Promise.resolve(new Map<string, unknown>()); }
  requestClose() { if (this.stopped) return; if (this.provider !== 'qwen') this.sendWire({ type: 'voice.close' }); this.dispose(); this.callbacks.event({ type: 'session.closed' }); }
  private fail(message: string) { if (this.stopped) return; this.callbacks.error(message); this.dispose(); this.callbacks.event({ type: 'provider.failed' }); }
  dispose() {
    if (this.stopped) return; this.stopped = true; this.channel.readyState = 'closed'; this.queue = []; this.awaiting = null;
    if (this.timeout) clearTimeout(this.timeout); if (this.ackTimeout) clearTimeout(this.ackTimeout); if (this.pingTimer) clearInterval(this.pingTimer);
    this.levelTimers.forEach(clearInterval); this.pcm?.close(); this.media?.getTracks().forEach(track => track.stop()); this.media = null;
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; } this.channels.forEach(channel => channel.close()); this.peer?.close();
    this.socket?.close(1000,'classroom ended'); void this.analyserContext?.close().catch(() => {}); this.callbacks.level('teacher',0);
  }
}
