const BYTES_PER_MILLISECOND = 48;
const FRAME_BYTES = 2400;
const MAX_CHUNK_BYTES = 192000;
const MAX_QUEUED_BYTES = 576000;
const MAX_FRAGMENTS = 1024;

export type PcmOutputClock = {
  now(): number;
  schedule(callback: () => void, milliseconds: number): unknown;
  cancel(handle: unknown): void;
};
type PacerOutput = { send(audio: string): boolean; error(message: string): void };

/** A bounded real-time queue for raw 24kHz mono PCM16; generation speed is not playback speed. */
export class PcmOutputPacer {
  private readonly clock: PcmOutputClock;
  private chunks: { bytes: Buffer; offset: number }[] = [];
  private bytes = 0;
  private nextAt = 0;
  private timer: unknown = null;
  private generation = 0;
  private closed = false;
  constructor(private readonly output: PacerOutput, clock?: PcmOutputClock) {
    this.clock = clock ?? { now: () => performance.now(), schedule: (callback, milliseconds) => setTimeout(callback, milliseconds), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  }
  get queuedBytes() { return this.bytes; }
  enqueue(audio: string): boolean {
    if (this.closed) return false;
    if (typeof audio !== 'string' || !audio || audio.length > Math.ceil(MAX_CHUNK_BYTES / 3) * 4 || audio.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return this.fail();
    const decoded = Buffer.from(audio, 'base64');
    if (!decoded.length || decoded.length % 2 || decoded.length > MAX_CHUNK_BYTES || decoded.toString('base64') !== audio || this.bytes + decoded.length > MAX_QUEUED_BYTES || this.chunks.length >= MAX_FRAGMENTS) return this.fail();
    this.chunks.push({ bytes: decoded, offset: 0 }); this.bytes += decoded.length;
    this.schedule(); return true;
  }
  private schedule() {
    if (this.closed || this.timer !== null || !this.bytes) return;
    const generation = this.generation;
    this.timer = this.clock.schedule(() => {
      if (this.closed || generation !== this.generation) return;
      this.timer = null; this.tick();
    }, Math.max(0, this.nextAt - this.clock.now()));
  }
  private tick() {
    if (this.closed || !this.bytes) return;
    const count = Math.min(FRAME_BYTES, this.bytes), frame = Buffer.allocUnsafe(count);
    let written = 0;
    while (written < count) {
      const first = this.chunks[0], size = Math.min(count - written, first.bytes.length - first.offset);
      first.bytes.copy(frame, written, first.offset, first.offset + size);
      first.offset += size; written += size;
      if (first.offset === first.bytes.length) this.chunks.shift();
    }
    this.bytes -= count;
    try { if (!this.output.send(frame.toString('base64'))) { this.fail(); return; } }
    catch { this.fail(); return; }
    // Never catch up after event-loop stalls by dumping accumulated frames at once.
    this.nextAt = Math.max(this.nextAt, this.clock.now()) + count / BYTES_PER_MILLISECOND;
    this.schedule();
  }
  clear() {
    this.generation++;
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = null; this.chunks = []; this.bytes = 0; this.nextAt = this.clock.now();
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.clear();
  }
  private fail(): false {
    if (!this.closed) {
      this.close(); this.output.error('实时声音积压或格式异常，连接已停止，请重新连接。');
    }
    return false;
  }
}
