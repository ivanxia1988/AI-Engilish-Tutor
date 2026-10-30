/** Browser PCM audio only. Transport and MediaStream track ownership stay outside. */
export type PcmVoiceAudioOptions = {
  inputSampleRate: number;
  frameMs: number;
  onFrame: (audioBase64: string) => void;
  onLevel: (role: 'child' | 'teacher', level: number) => void;
  onQueue?: (milliseconds: number) => void;
  onIssue?: (message: string) => void;
};
export type PcmAudioDependencies = {
  context: () => AudioContext;
  worklet: (context: AudioContext, options: AudioWorkletNodeOptions) => AudioWorkletNode;
  every: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  clear: (timer: ReturnType<typeof setInterval>) => void;
};
export const MAX_PCM_MESSAGE_BYTES = 192_000;
export const MAX_PLAYBACK_QUEUE_SECONDS = 2;
const MAX_PLAYBACK_SOURCES = 256;
const MAX_CAPTURE_BACKLOG_SECONDS = .5;
const validRate = (value: number) => Number.isInteger(value) && value >= 8000 && value <= 48000;

export function pcmBytesToBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.length > MAX_PCM_MESSAGE_BYTES) throw new Error('PCM message is too large.');
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

/** Provider output must be mono signed little-endian PCM16, never a media file. */
export function decodePcm16(base64: string): Float32Array<ArrayBuffer> {
  if (typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(MAX_PCM_MESSAGE_BYTES / 3) * 4 || base64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Invalid PCM message.');
  let binary: string;
  try { binary = atob(base64); } catch { throw new Error('Invalid PCM encoding.'); }
  if (!binary.length || binary.length > MAX_PCM_MESSAGE_BYTES || binary.length % 2) throw new Error('Invalid PCM byte count.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer), values = new Float32Array(bytes.length / 2);
  for (let i = 0; i < values.length; i++) values[i] = view.getInt16(i * 2, true) / 32768;
  return values;
}

type Playback = { source: AudioBufferSourceNode; samples: Float32Array<ArrayBuffer>; rate: number; start: number; end: number };

export class PcmVoiceAudio {
  private readonly options: PcmVoiceAudioOptions;
  private readonly dependencies: PcmAudioDependencies;
  private readonly context: AudioContext;
  private input: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private captureStarting = false;
  private closed = false;
  private failed = false;
  private muted = false;
  private captureEpoch = 0;
  private lastCaptureAt = -Infinity;
  private playback = new Map<AudioBufferSourceNode, Playback>();
  private nextAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(options: PcmVoiceAudioOptions, dependencies: Partial<PcmAudioDependencies> = {}) {
    if (!validRate(options.inputSampleRate) || !Number.isFinite(options.frameMs) || options.frameMs < 10 || options.frameMs > 250 || !Number.isInteger(options.inputSampleRate * options.frameMs / 1000)) throw new Error('不支持当前语音采样配置。');
    this.options = options;
    this.dependencies = {
      context: () => {
        if (typeof AudioContext === 'undefined') throw new Error('当前浏览器不支持实时 PCM 语音，请更换浏览器。');
        return new AudioContext({ latencyHint: 'interactive' });
      },
      worklet: (context, configuration) => new AudioWorkletNode(context, 'littleleaf-pcm-capture', configuration),
      every: (callback, milliseconds) => setInterval(callback, milliseconds),
      clear: timer => clearInterval(timer),
      ...dependencies,
    };
    // Construct synchronously from the connect gesture so autoplay policy can
    // authorize audio. A later getUserMedia/addModule continuation is too late.
    this.context = this.dependencies.context();
    void this.context.resume().catch(() => {});
  }
  private ensureTimer() {
    if (this.timer === null) this.timer = this.dependencies.every(() => this.tick(), 40);
  }
  private issue(message: string) {
    if (this.failed || this.closed) return;
    this.failed = true; this.close(); this.options.onIssue?.(message);
  }
  async startCapture(stream: MediaStream): Promise<void> {
    if (this.closed) throw new Error('语音采集已经结束，请重新连接。');
    if (this.capture || this.captureStarting) throw new Error('语音采集已经开启。');
    this.captureStarting = true;
    try {
      if (!this.context.audioWorklet) throw new Error('AudioWorklet unavailable.');
      await this.context.resume();
      await this.context.audioWorklet.addModule('/voice-capture.worklet.js');
      if (this.closed) throw new Error('Capture closed while loading.');
      const capture = this.dependencies.worklet(this.context, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, processorOptions: { sampleRate: this.options.inputSampleRate, frameMs: this.options.frameMs } });
      this.capture = capture;
      capture.onprocessorerror = () => this.issue('实时语音采集发生异常，请重新连接。');
      capture.port.onmessage = event => {
        if (this.closed || this.muted || event.data?.type !== 'frame' || event.data.epoch !== this.captureEpoch) return;
        const frame = event.data.audio;
        const expectedBytes = this.options.inputSampleRate * this.options.frameMs / 1000 * 2;
        if (!(frame instanceof ArrayBuffer) || frame.byteLength !== expectedBytes) { this.issue('语音采集返回了异常音频帧，请重新连接。'); return; }
        if (typeof event.data.at === 'number' && this.context.currentTime - event.data.at > MAX_CAPTURE_BACKLOG_SECONDS) { this.issue('浏览器音频采集积压，已停止发送以免突发上传旧声音，请重新连接。'); return; }
        this.lastCaptureAt = this.context.currentTime;
        const level = typeof event.data.level === 'number' && Number.isFinite(event.data.level) ? Math.max(0, Math.min(1, event.data.level)) : 0;
        this.options.onLevel('child', level);
        try { this.options.onFrame(pcmBytesToBase64(frame)); }
        catch { this.issue('实时语音发送失败，请重新连接。'); }
      };
      this.input = this.context.createMediaStreamSource(stream);
      this.sink = this.context.createGain(); this.sink.gain.value = 0;
      this.input.connect(capture); capture.connect(this.sink); this.sink.connect(this.context.destination);
      capture.port.postMessage({ type: 'mute', muted: this.muted, epoch: this.captureEpoch });
      this.ensureTimer();
    } catch {
      if (!this.closed) this.issue('无法启动实时 PCM 采集，请确认浏览器支持 AudioWorklet 并重新连接。');
      throw new Error('无法启动实时 PCM 语音采集。');
    } finally { this.captureStarting = false; }
  }
  playChunk(base64: string, sampleRate: number): void {
    if (this.closed) return;
    try {
      if (!validRate(sampleRate)) throw new Error('Invalid audio sample rate.');
      const samples = decodePcm16(base64), now = this.context.currentTime;
      const start = Math.max(now + .015, this.nextAt), end = start + samples.length / sampleRate;
      if (end - now > MAX_PLAYBACK_QUEUE_SECONDS || this.playback.size >= MAX_PLAYBACK_SOURCES) {
        this.issue('老师声音积压超过安全播放范围，已停止本次音频，请重新连接或切换网络。'); return;
      }
      const buffer = this.context.createBuffer(1, samples.length, sampleRate); buffer.copyToChannel(samples, 0);
      const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.context.destination);
      const entry: Playback = { source, samples, rate: sampleRate, start, end };
      this.playback.set(source, entry); this.nextAt = end;
      source.onended = () => { this.playback.delete(source); try { source.disconnect(); } catch {} };
      source.start(start);
      this.options.onQueue?.(Math.max(0, end - now) * 1000); this.ensureTimer();
    } catch { this.issue('老师音频格式异常，已停止播放，请重新连接。'); }
  }
  private tick() {
    if (this.closed) return;
    const now = this.context.currentTime;
    if (this.muted || this.context.state !== 'running' || now - this.lastCaptureAt > .25) this.options.onLevel('child', 0);
    let energy = 0, count = 0;
    for (const entry of this.playback.values()) {
      if (entry.end <= now) { this.playback.delete(entry.source); try { entry.source.disconnect(); } catch {} continue; }
      if (this.context.state !== 'running' || now < entry.start) continue;
      const first = Math.max(0, Math.floor((now - entry.start) * entry.rate));
      const last = Math.min(entry.samples.length, first + Math.round(entry.rate * .02));
      for (let i = first; i < last; i++) { energy += entry.samples[i] ** 2; count++; }
    }
    // The clock reaches a scheduled sample only when WebAudio is running. Network
    // arrival alone is never treated as the teacher having audibly begun speaking.
    this.options.onLevel('teacher', count ? Math.sqrt(energy / count) : 0);
    this.options.onQueue?.(Math.max(0, this.nextAt - now) * 1000);
  }
  cancelPlayback(): void {
    for (const { source } of this.playback.values()) { source.onended = null; try { source.stop(); } catch {} try { source.disconnect(); } catch {} }
    this.playback.clear(); this.nextAt = this.context.currentTime;
    this.options.onLevel('teacher', 0); this.options.onQueue?.(0);
  }
  mute(value: boolean): void {
    if (this.closed) return;
    this.muted = value; this.captureEpoch++;
    this.capture?.port.postMessage({ type: 'mute', muted: value, epoch: this.captureEpoch });
    this.lastCaptureAt = -Infinity; this.options.onLevel('child', 0);
  }
  async resume(): Promise<void> {
    if (this.closed) return;
    try { await this.context.resume(); } catch { this.issue('浏览器暂停了语音播放，请重新连接后允许播放声音。'); }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.captureEpoch++;
    if (this.timer !== null) this.dependencies.clear(this.timer); this.timer = null;
    this.cancelPlayback();
    if (this.capture) {
      this.capture.onprocessorerror = null; this.capture.port.onmessage = null;
      try { this.capture.port.postMessage({ type: 'stop' }); this.capture.port.close(); } catch {}
      try { this.capture.disconnect(); } catch {} this.capture = null;
    }
    try { this.input?.disconnect(); } catch {} this.input = null;
    try { this.sink?.disconnect(); } catch {} this.sink = null;
    this.options.onLevel('child', 0);
    // The transport owns and stops stream.getTracks(); closing this graph never
    // claims ownership of a caller's MediaStream or its shared microphone tracks.
    void this.context.close().catch(() => {});
  }
}
