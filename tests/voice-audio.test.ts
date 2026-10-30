import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { decodePcm16, MAX_PCM_MESSAGE_BYTES, PcmVoiceAudio, pcmBytesToBase64, type PcmAudioDependencies } from '../lib/voice-audio';

function pcm(samples: number[]) {
  const bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer);
  samples.forEach((value, index) => view.setInt16(index * 2, value, true));
  return pcmBytesToBase64(bytes);
}
function tone(duration: number, rate = 24000, amplitude = 16000) { return pcm(Array.from({ length: Math.round(duration * rate) }, () => amplitude)); }

test('PCM helpers preserve signed little-endian samples and reject malformed or oversized input before allocation', () => {
  assert.deepEqual(Array.from(decodePcm16(pcm([-32768, -16384, 0, 16384, 32767]))), [-1, -.5, 0, .5, 32767 / 32768]);
  for (const invalid of ['', 'a', '!!!!', 'AA==', 'AAA===', 'data:audio/wav;base64,AAAA', 'A'.repeat(Math.ceil(MAX_PCM_MESSAGE_BYTES / 3) * 4 + 4)]) assert.throws(() => decodePcm16(invalid));
  assert.throws(() => pcmBytesToBase64(new Uint8Array(MAX_PCM_MESSAGE_BYTES + 1)));
});

const workletCode = readFileSync(new URL('../public/voice-capture.worklet.js', import.meta.url), 'utf8');
function captureHarness(nativeRate: number, outputRate: number, frameMs: number) {
  let Processor: any;
  const frames: { type: string; audio: ArrayBuffer; level: number; at: number; epoch: number }[] = [];
  const globals = {
    sampleRate: nativeRate, currentTime: 0, Float32Array, ArrayBuffer, DataView, Math, Number,
    AudioWorkletProcessor: class { port = { onmessage: null as ((event: any) => void) | null, postMessage: (data: any) => frames.push(data) }; },
    registerProcessor: (_name: string, klass: any) => { Processor = klass; },
  };
  runInNewContext(workletCode, globals);
  const processor = new Processor({ processorOptions: { sampleRate: outputRate, frameMs } });
  let position = 0;
  const process = (input: Float32Array, sizes: number[]) => {
    let offset = 0, block = 0;
    while (offset < input.length) {
      const size = Math.min(sizes[block++ % sizes.length], input.length - offset);
      globals.currentTime = position / nativeRate;
      const output = new Float32Array(size).fill(1);
      processor.process([[input.subarray(offset, offset + size)]], [[output]]);
      assert(output.every(value => value === 0), 'microphone graph output must be silent');
      offset += size; position += size;
    }
  };
  return { frames, processor, process };
}
function joinedPcm(frames: { audio: ArrayBuffer }[]) {
  const bytes = new Uint8Array(frames.reduce((count, frame) => count + frame.audio.byteLength, 0));
  let offset = 0;
  for (const frame of frames) { bytes.set(new Uint8Array(frame.audio), offset); offset += frame.audio.byteLength; }
  return bytes;
}

test('the actual capture worklet continuously resamples 44.1/48k render quanta into exact 20/100ms PCM frames', () => {
  for (const rate of [44100, 48000]) for (const frameMs of [20, 100]) {
    const samples = Float32Array.from({ length: rate }, (_, index) => .5 * Math.sin(2 * Math.PI * 1000 * index / rate));
    const a = captureHarness(rate, 16000, frameMs), b = captureHarness(rate, 16000, frameMs);
    a.process(samples, [128]); b.process(samples, [37, 111, 256, 19]);
    assert.equal(a.frames.length, 1000 / frameMs);
    assert(a.frames.every(frame => frame.audio.byteLength === 16000 * frameMs / 1000 * 2));
    assert.deepEqual(joinedPcm(a.frames), joinedPcm(b.frames), 'block boundaries must not alter output');
    const output = decodePcm16(pcmBytesToBase64(joinedPcm(a.frames))), rms = Math.sqrt(output.subarray(100).reduce((sum, value) => sum + value ** 2, 0) / (output.length - 100));
    assert(rms > .33 && rms < .37, `1kHz speech-band amplitude must survive, got ${rms}`);
  }
});

test('capture anti-aliases downsampling and mute drops partial old speech rather than replaying it on resume', () => {
  const high = captureHarness(48000, 16000, 20);
  high.process(Float32Array.from({ length: 48000 }, (_, index) => .5 * Math.sin(2 * Math.PI * 12000 * index / 48000)), [128]);
  const filtered = decodePcm16(pcmBytesToBase64(joinedPcm(high.frames))).subarray(100);
  const rms = Math.sqrt(filtered.reduce((sum, value) => sum + value ** 2, 0) / filtered.length);
  assert(rms < .03, `out-of-band signal must not alias into 4kHz, got ${rms}`);
  const muted = captureHarness(16000, 16000, 20);
  muted.process(new Float32Array(160).fill(.7), [128]); assert.equal(muted.frames.length, 0);
  muted.processor.port.onmessage({ data: { type: 'mute', muted: true, epoch: 1 } });
  muted.process(new Float32Array(1600).fill(.7), [128]); assert.equal(muted.frames.length, 0);
  muted.processor.port.onmessage({ data: { type: 'mute', muted: false, epoch: 2 } });
  muted.process(new Float32Array(320).fill(.2), [128]); assert.equal(muted.frames.length, 1);
  assert.equal(muted.frames[0].epoch, 2);
  const resumed = decodePcm16(pcmBytesToBase64(muted.frames[0].audio)); assert(resumed.every(value => value > .19 && value < .21));
  muted.processor.port.onmessage({ data: { type: 'stop' } });
  assert.equal(muted.processor.process([[new Float32Array(128)]], [[new Float32Array(128)]]), false);
});

class FakeSource {
  buffer: any; onended: (() => void) | null = null; startedAt: number | null = null; stopped = false; disconnected = false;
  connect() {} start(at: number) { this.startedAt = at; } stop() { this.stopped = true; } disconnect() { this.disconnected = true; }
}
function audioHarness(options: { addModule?: () => Promise<void> } = {}) {
  const sources: FakeSource[] = [], messages: any[] = [], issues: string[] = [], frames: string[] = [], levels: [string, number][] = [], queues: number[] = [];
  let tick: (() => void) | null = null, cleared = 0, trackStops = 0, moduleCalls = 0;
  const capture = { port: { onmessage: null as ((event: any) => void) | null, postMessage: (message: unknown) => messages.push(message), close() {} }, onprocessorerror: null, connect() {}, disconnect() {} };
  const context = {
    currentTime: 0, state: 'running', closeCalls: 0, resumeCalls: 0, destination: {},
    audioWorklet: { addModule: async () => { moduleCalls++; await options.addModule?.(); } },
    resume: async () => { context.resumeCalls++; context.state = 'running'; },
    close: async () => { context.closeCalls++; context.state = 'closed'; },
    createBuffer: (_channels: number, size: number, rate: number) => ({ duration: size / rate, copyToChannel: (values: Float32Array) => assert.equal(values.length, size) }),
    createBufferSource: () => { const source = new FakeSource(); sources.push(source); return source; },
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
  };
  const dependencies: Partial<PcmAudioDependencies> = {
    context: () => context as unknown as AudioContext,
    worklet: () => capture as unknown as AudioWorkletNode,
    every: callback => { tick = callback; return 1 as unknown as ReturnType<typeof setInterval>; },
    clear: () => { cleared++; tick = null; },
  };
  const audio = new PcmVoiceAudio({ inputSampleRate: 16000, frameMs: 20, onFrame: frame => frames.push(frame), onLevel: (role, level) => levels.push([role, level]), onQueue: value => queues.push(value), onIssue: message => issues.push(message) }, dependencies);
  const stream = { getTracks: () => [{ stop: () => { trackStops++; } }] } as unknown as MediaStream;
  return { audio, stream, capture, context, sources, messages, issues, frames, levels, queues, tick: () => tick?.(), get cleared() { return cleared; }, get trackStops() { return trackStops; }, get moduleCalls() { return moduleCalls; } };
}

test('playback uses the audio clock, preserves contiguous scheduling and cancels every future source on interruption', () => {
  const h = audioHarness();
  assert.equal(h.context.resumeCalls, 1);
  h.audio.playChunk(tone(.1), 24000); h.audio.playChunk(tone(.1), 24000);
  assert.equal(h.sources[0].startedAt, .015); assert.equal(h.sources[1].startedAt, .115);
  assert.equal(h.levels.length, 0, 'receiving a chunk is not audible teacher speech');
  h.tick(); assert.equal(h.levels.at(-1)?.[1], 0);
  h.context.currentTime = .035; h.tick(); assert(h.levels.at(-1)![1] > .45);
  h.audio.cancelPlayback(); assert(h.sources.every(source => source.stopped && source.disconnected));
  assert.equal(h.queues.at(-1), 0); assert.equal(h.levels.at(-1)?.[1], 0);
  h.context.currentTime = 1; h.audio.playChunk(tone(.1), 24000); assert.equal(h.sources[2].startedAt, 1.015);
  h.context.currentTime = 2; h.tick(); assert.equal(h.levels.at(-1)?.[1], 0); assert.deepEqual(h.issues, [], 'ordinary silence is never an underrun/stutter');
  h.audio.close(); assert.equal(h.context.closeCalls, 1); assert.equal(h.cleared, 1); assert.equal(h.trackStops, 0);
});

test('suspended audio reports zero teacher level and queue overflow explicitly terminates playback', async () => {
  const h = audioHarness(); h.audio.playChunk(tone(.1), 24000);
  h.context.state = 'suspended'; h.context.currentTime = .03; h.tick(); assert.equal(h.levels.at(-1)?.[1], 0);
  await h.audio.resume(); h.tick(); assert(h.levels.at(-1)![1] > .45);
  h.audio.cancelPlayback();
  for (let i = 0; i < 20; i++) h.audio.playChunk(tone(.1), 24000);
  assert.equal(h.issues.length, 1); assert.match(h.issues[0], /积压/); assert.equal(h.context.closeCalls, 1);
  assert(h.sources.every(source => source.stopped && source.disconnected));
  h.audio.playChunk(tone(.1), 24000); assert.equal(h.issues.length, 1, 'failure must not restart or retry billed media');
});

test('capture epochs reject queued pre-mute frames and close releases nodes without owning microphone tracks', async () => {
  const h = audioHarness(); await h.audio.startCapture(h.stream); assert.equal(h.moduleCalls, 1);
  const message = (epoch: number) => ({ data: { type: 'frame', audio: new ArrayBuffer(640), level: .1, at: h.context.currentTime, epoch } });
  h.capture.port.onmessage?.(message(0)); assert.equal(h.frames.length, 1);
  h.audio.mute(true); h.capture.port.onmessage?.(message(0)); assert.equal(h.frames.length, 1);
  h.audio.mute(false); h.capture.port.onmessage?.(message(0)); h.capture.port.onmessage?.(message(1)); assert.equal(h.frames.length, 1);
  h.capture.port.onmessage?.(message(2)); assert.equal(h.frames.length, 2);
  assert.deepEqual(h.messages.slice(-2).map(message => [message.muted, message.epoch]), [[true, 1], [false, 2]]);
  h.audio.close(); h.audio.close(); assert.equal(h.context.closeCalls, 1); assert.equal(h.trackStops, 0); assert.equal(h.capture.port.onmessage, null);
});

test('old capture backlogs and malformed output fail visibly rather than sending bursts or allocating unbounded memory', async () => {
  const h = audioHarness(); await h.audio.startCapture(h.stream); h.context.currentTime = 1;
  h.capture.port.onmessage?.({ data: { type: 'frame', audio: new ArrayBuffer(640), level: .1, at: 0, epoch: 0 } });
  assert.equal(h.frames.length, 0); assert.equal(h.issues.length, 1); assert.match(h.issues[0], /积压/);
  const bad = audioHarness(); bad.audio.playChunk('AA==', 24000); assert.equal(bad.issues.length, 1); assert.match(bad.issues[0], /格式/); assert.equal(bad.context.closeCalls, 1);
});

test('closing while the worklet module loads cannot attach a late live microphone graph', async () => {
  let release: (() => void) | undefined;
  const h = audioHarness({ addModule: () => new Promise<void>(resolve => { release = resolve; }) });
  const loading = h.audio.startCapture(h.stream); await Promise.resolve(); await Promise.resolve();
  assert(release); h.audio.close(); release(); await assert.rejects(loading);
  assert.equal(h.capture.port.onmessage, null); assert.equal(h.context.closeCalls, 1); assert.equal(h.trackStops, 0);
});
