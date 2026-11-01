import type { ClassroomSnapshot } from './classroom-contract';
import { PcmVoiceAudio, type PcmVoiceAudioOptions } from './voice-audio';
import { classroomVoiceFailure, type ClassroomVoiceErrorCode, type ClassroomVoiceFailure } from './classroom-voice-errors';
import {ClassroomCameraFrames,CLASSROOM_CAMERA_FRAME_BASE64,type ClassroomCameraFrameOwner} from './classroom-camera-frames';
import {CLASSROOM_VISION_MAX_BASE64,type ClassroomVisionState} from './classroom-vision';

type VoiceState = 'connecting' | 'connected' | 'closed' | 'error';
type AudioOwner = Pick<PcmVoiceAudio, 'startCapture' | 'playChunk' | 'cancelPlayback' | 'mute' | 'resume' | 'close'>;
export type ClassroomVoiceClientOptions = {
  classroomId: string; provider: 'qwen' | 'openai';
  onState(state: VoiceState): void;
  onSnapshot(snapshot: ClassroomSnapshot): void;
  onLevel(role: 'child' | 'teacher', level: number): void;
  onError(message: string): void;
  onFailure?(failure: ClassroomVoiceFailure): void;
  onPlaybackQueue?(milliseconds: number): void;
  onVisionState?(state:ClassroomVisionState):void;
};
export type ClassroomVoiceClientDependencies = {
  media(): Promise<MediaStream>;
  socket(url: string): WebSocket;
  origin(): string;
  audio(options: PcmVoiceAudioOptions): AudioOwner;
  startupMs: number; closeMs: number;
  frames?():ClassroomCameraFrameOwner;
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
  private visionGeneration=0;
  private visionActive=false;
  private visionSequence=0;
  private frames:ClassroomCameraFrameOwner|null=null;
  private visionStartup:ReturnType<typeof setTimeout>|null=null;
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
        onFrame: audio => { if (this.ready && !this.stopped && !this.muted && !this.send({ type: 'audio', audio })) this.fail('声音发送积压，连接已停止，请重新连接。', 'input_rate_limited'); },
        onLevel: (role, level) => { if (!this.stopped) this.options.onLevel(role, level); },
        onQueue: milliseconds => { if (!this.stopped) this.options.onPlaybackQueue?.(milliseconds); },
        onIssue: (message, code) => this.fail(message, code ?? 'audio_capture_failed'),
      });
      const stream = await this.dependencies.media();
      if (this.stopped) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const url = new URL(`/ws/classrooms/${encodeURIComponent(this.options.classroomId)}`, this.dependencies.origin());
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      this.socket = this.dependencies.socket(url.href);
      const completion = new Promise<void>((resolve, reject) => { this.startResolve = resolve; this.startReject = reject; });
      this.startup = setTimeout(() => this.fail('语音连接超时，请重试。', 'startup_timeout'), this.dependencies.startupMs);
      this.socket.onmessage = event => { void this.receive(event.data); };
      this.socket.onerror = () => this.fail('语音连接未成功，请检查网络后重试。');
      this.socket.onclose = () => {
        this.closeResolve?.();
        if (!this.stopped) this.fail('语音连接已断开，请重新连接。');
      };
      await completion;
    } catch (error) {
      if (!this.stopped) this.fail(error instanceof Error && error.message.includes('当前浏览器') ? error.message : '无法打开麦克风或连接语音服务，请检查权限后重试。', 'microphone_denied');
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
      if (event.inputSampleRate !== (this.options.provider === 'qwen' ? 16000 : 24000) || event.outputSampleRate !== 24000) { this.fail('语音采样配置不一致，请重新连接。', 'invalid_audio'); return; }
      this.ready = true;
      try {
        await this.audio?.startCapture(this.stream!);
        if (this.stopped) return;
        this.audio?.mute(this.muted);
        if (this.startup) clearTimeout(this.startup); this.startup = null;
        this.options.onState('connected'); this.startResolve?.(); this.startResolve = null; this.startReject = null;
      } catch { if (!this.stopped) this.fail('无法启动麦克风采集，请重新连接。', 'audio_capture_failed'); }
    } else if(event.type==='vision.state'){
      if(!this.visionActive||event.generation!==this.visionGeneration||!['off','starting','sharing','error','unavailable'].includes(String(event.status)))return;
      const status=event.status as ClassroomVisionState['status'];
      if(status!=='starting'&&this.visionStartup){clearTimeout(this.visionStartup);this.visionStartup=null;}
      if(status==='off'||status==='error'||status==='unavailable'){this.frames?.stop();this.frames=null;this.visionActive=false;}
      this.publishVision(status);
    } else if (event.type === 'audio' && this.ready && typeof event.audio === 'string' && event.sampleRate === 24000) this.audio?.playChunk(event.audio, 24000);
    else if (event.type === 'interrupt') this.audio?.cancelPlayback();
    else if (event.type === 'snapshot') {
      const value = event.classroom;
      if (value && typeof value === 'object' && 'id' in value && value.id === this.options.classroomId && 'revision' in value && Number.isInteger(value.revision)) this.options.onSnapshot(value as ClassroomSnapshot);
    } else if (event.type === 'error') { const failure = classroomVoiceFailure(event.code); this.fail(failure.message, failure.code); }
    else if (event.type === 'closed') {
      this.stopped = true; this.releaseLocal(); this.startResolve?.(); this.startResolve = null; this.startReject = null; this.closeResolve?.();
      this.socket?.close(); this.options.onState('closed');
    }
  }
  private releaseLocal() {
    this.stopVision();
    if (this.startup) clearTimeout(this.startup); this.startup = null;
    this.ready = false;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.audio?.close(); this.audio = null;
    this.options.onLevel('child', 0); this.options.onLevel('teacher', 0);
    this.options.onPlaybackQueue?.(0);
  }
  private fail(message: string, code: ClassroomVoiceErrorCode = 'transport_error') {
    if (this.stopped) return;
    this.stopped = true; this.releaseLocal();
    this.startReject?.(new Error(message)); this.startReject = null; this.startResolve = null;
    this.options.onFailure?.({ code, message });
    this.send({ type: 'close' }); this.socket?.close(); this.options.onError(message); this.options.onState('error');
  }
  sendText(text: string): boolean {
    return this.ready && !this.stopped && text.trim().length > 0 && text.length <= 1000 && this.send({ type: 'text', text: text.trim() });
  }
  private publishVision(status:ClassroomVisionState['status']){
    const messages={off:'',starting:'正在开启画面分享…',sharing:'画面分享中',error:'画面分享已停止，请重试；语音课堂可以继续。',unavailable:'当前课堂暂不支持画面分享，可以继续语音上课。'};
    this.options.onVisionState?.({status,generation:this.visionGeneration,message:messages[status]});
  }
  startVision(stream:MediaStream):boolean{
    if(!this.ready||this.stopped)return false;
    this.stopVision();this.visionGeneration++;this.visionSequence=0;this.visionActive=true;
    if(!this.send({type:'vision.start',generation:this.visionGeneration})){this.visionActive=false;this.publishVision('error');return false;}
    this.publishVision('starting');const generation=this.visionGeneration;
    const failed=()=>{if(!this.visionActive||generation!==this.visionGeneration)return;this.stopVision();this.publishVision('error');};
    this.visionStartup=setTimeout(failed,10000);
    try{
     const frames=this.dependencies.frames?.()??new ClassroomCameraFrames();this.frames=frames;
     frames.start(stream,image=>{
      if(!this.visionActive||this.stopped||generation!==this.visionGeneration)return;
      if(image.length>CLASSROOM_VISION_MAX_BASE64){failed();return;}
      // Never let images consume the audio/control queue's 64KB budget.
      if(!this.socket||this.socket.readyState!==1||this.socket.bufferedAmount>0||image.length>CLASSROOM_CAMERA_FRAME_BASE64)return;
      try{this.socket.send(JSON.stringify({type:'vision.frame',generation,sequence:++this.visionSequence,image}));}catch{failed();}
     },failed);
    }catch{failed();return false;}
    return this.visionActive;
  }
  stopVision():void{
    if(this.visionStartup)clearTimeout(this.visionStartup);this.visionStartup=null;
    const active=this.visionActive;this.visionActive=false;this.frames?.stop();this.frames=null;
    if(active)this.send({type:'vision.stop',generation:this.visionGeneration});
    this.publishVision('off');
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
