import type { ClassroomSnapshot } from './classroom-contract';
import { PcmVoiceAudio, type PcmVoiceAudioOptions } from './voice-audio';

type VoiceState = 'connecting' | 'connected' | 'closed' | 'error';
type AudioOwner = Pick<PcmVoiceAudio, 'startCapture' | 'playChunk' | 'cancelPlayback' | 'mute' | 'resume' | 'close'>;
export type ClassroomVoiceClientOptions = {
  classroomId: string; provider: 'qwen' | 'openai';
  onState(state: VoiceState): void;
  onSnapshot(snapshot: ClassroomSnapshot): void;
  onLevel(role: 'child' | 'teacher', level: number): void;
  onError(message: string): void;
};
export type ClassroomVoiceClientDependencies = {
  media(): Promise<MediaStream>;
  socket(url: string): WebSocket;
  origin(): string;
  audio(options: PcmVoiceAudioOptions): AudioOwner;
  startupMs: number; closeMs: number;
};

/** One explicitly started microphone and server-owned connection. No stored audio or credentials. */
export class ClassroomVoiceClient {
  private readonly dependencies: ClassroomVoiceClientDependencies;
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private audio: AudioOwner | null = null;
  private stopped = false;
  private started = false;
  private ready = false;
  private muted = false;
  private startup: ReturnType<typeof setTimeout> | null = null;
  private startResolve: (() => void) | null = null;
  private startReject: ((reason: Error) => void) | null = null;
  private closeResolve: (() => void) | null = null;
  private closing: Promise<void> | null = null;
  constructor(private readonly options: ClassroomVoiceClientOptions, dependencies: Partial<ClassroomVoiceClientDependencies> = {}) {
    this.dependencies = {
      media: () => {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法使用麦克风，请使用 HTTPS 或本机页面。');
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      },
      socket: url => new WebSocket(url), origin: () => location.origin,
      audio: audioOptions => new PcmVoiceAudio(audioOptions), startupMs: 25000, closeMs: 3500,
      ...dependencies,
    };
  }
  async start(): Promise<void> {
    if (this.started || this.stopped) throw new Error('本次语音连接已经使用，请重新连接。');
    this.started = true; this.options.onState('connecting');
    try {
      // Build WebAudio before awaiting microphone permission, while the click still authorizes playback.
      this.audio = this.dependencies.audio({ inputSampleRate: this.options.provider === 'qwen' ? 16000 : 24000, frameMs: 100,
        onFrame: audio => { if (this.ready && !this.stopped && !this.muted && !this.send({ type: 'audio', audio })) this.fail('声音发送积压，连接已停止，请重新连接。'); },
        onLevel: (role, level) => { if (!this.stopped) this.options.onLevel(role, level); },
        onIssue: message => this.fail(message),
      });
      const stream = await this.dependencies.media();
      if (this.stopped) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const url = new URL(`/ws/classrooms/${encodeURIComponent(this.options.classroomId)}`, this.dependencies.origin());
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      this.socket = this.dependencies.socket(url.href);
      const completion = new Promise<void>((resolve, reject) => { this.startResolve = resolve; this.startReject = reject; });
      this.startup = setTimeout(() => this.fail('语音连接超时，请重试。'), this.dependencies.startupMs);
      this.socket.onmessage = event => { void this.receive(event.data); };
      this.socket.onerror = () => this.fail('语音连接未成功，请检查网络后重试。');
      this.socket.onclose = () => {
        this.closeResolve?.();
        if (!this.stopped) this.fail('语音连接已断开，请重新连接。');
      };
      await completion;
    } catch (error) {
      if (!this.stopped) this.fail(error instanceof Error && error.message.includes('当前浏览器') ? error.message : '无法打开麦克风或连接语音服务，请检查权限后重试。');
      throw error;
    }
  }
  private send(event: unknown) {
    if (!this.socket || this.socket.readyState !== 1 || this.socket.bufferedAmount > 64_000) return false;
    try { this.socket.send(JSON.stringify(event)); return true; } catch { return false; }
  }
  private async receive(raw: unknown) {
    if (this.stopped || typeof raw !== 'string' || raw.length > 512_000) return;
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw) as Record<string, unknown>; if (!event || typeof event !== 'object') return; } catch { this.fail('语音服务响应异常，请重新连接。'); return; }
    if (event.type === 'ready') {
      if (this.ready) return;
      if (event.inputSampleRate !== (this.options.provider === 'qwen' ? 16000 : 24000) || event.outputSampleRate !== 24000) { this.fail('语音采样配置不一致，请重新连接。'); return; }
      this.ready = true;
      try {
        await this.audio?.startCapture(this.stream!);
        if (this.stopped) return;
        this.audio?.mute(this.muted);
        if (this.startup) clearTimeout(this.startup); this.startup = null;
        this.options.onState('connected'); this.startResolve?.(); this.startResolve = null; this.startReject = null;
      } catch { if (!this.stopped) this.fail('无法启动麦克风采集，请重新连接。'); }
    } else if (event.type === 'audio' && this.ready && typeof event.audio === 'string' && event.sampleRate === 24000) this.audio?.playChunk(event.audio, 24000);
    else if (event.type === 'interrupt') this.audio?.cancelPlayback();
    else if (event.type === 'snapshot') {
      const value = event.classroom;
      if (value && typeof value === 'object' && 'id' in value && value.id === this.options.classroomId && 'revision' in value && Number.isInteger(value.revision)) this.options.onSnapshot(value as ClassroomSnapshot);
    } else if (event.type === 'error') this.fail(typeof event.message === 'string' && event.message.length <= 200 ? event.message : '语音连接暂时不可用，请重试。');
    else if (event.type === 'closed') {
      this.stopped = true; this.releaseLocal(); this.startResolve?.(); this.startResolve = null; this.startReject = null; this.closeResolve?.();
      this.socket?.close(); this.options.onState('closed');
    }
  }
  private releaseLocal() {
    if (this.startup) clearTimeout(this.startup); this.startup = null;
    this.ready = false;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.audio?.close(); this.audio = null;
    this.options.onLevel('child', 0); this.options.onLevel('teacher', 0);
  }
  private fail(message: string) {
    if (this.stopped) return;
    this.stopped = true; this.releaseLocal();
    this.startReject?.(new Error(message)); this.startReject = null; this.startResolve = null;
    this.send({ type: 'close' }); this.socket?.close(); this.options.onState('error'); this.options.onError(message);
  }
  sendText(text: string): boolean {
    return this.ready && !this.stopped && text.trim().length > 0 && text.length <= 1000 && this.send({ type: 'text', text: text.trim() });
  }
  setMuted(muted: boolean) {
    if (this.stopped) return;
    this.muted = muted; this.audio?.mute(muted); this.stream?.getTracks().forEach(track => { track.enabled = !muted; });
    if (this.ready) this.send({ type: 'mute', muted });
  }
  stop(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped = true; this.releaseLocal(); this.startResolve?.(); this.startResolve = null; this.startReject = null;
    this.closing = (async () => {
      if (this.socket?.readyState === 1) {
        await new Promise<void>(resolve => {
          const timeout = setTimeout(resolve, this.dependencies.closeMs);
          this.closeResolve = () => { clearTimeout(timeout); resolve(); };
          if (!this.send({ type: 'close' })) this.closeResolve();
        });
      }
      this.socket?.close(); this.options.onState('closed');
    })();
    return this.closing;
  }
  dispose() {
    this.stopped = true; this.releaseLocal(); this.startResolve?.(); this.startResolve = null; this.startReject = null;
    this.send({ type: 'close' }); this.socket?.close(); this.closeResolve?.();
  }
}
