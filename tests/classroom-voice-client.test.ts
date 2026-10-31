import assert from 'node:assert/strict';
import test from 'node:test';
import { ClassroomVoiceClient, type ClassroomVoiceClientDependencies } from '../lib/classroom-voice-client';
import type { ClassroomSnapshot } from '../lib/classroom-contract';
import type { PcmVoiceAudioOptions } from '../lib/voice-audio';

function harness() {
  const sent: Record<string, unknown>[] = [], states: string[] = [], snapshots: ClassroomSnapshot[] = [], errors: string[] = [], order: string[] = [];
  let tracksStopped = 0, audioClosed = 0, captures = 0, playback = 0, interrupted = 0, audioOptions: PcmVoiceAudioOptions | undefined;
  const track = { enabled: true, stop() { tracksStopped++; } };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  class Socket {
    readyState = 1; bufferedAmount = 0;
    onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null; onerror: (() => void) | null = null; onclose: (() => void) | null = null;
    send(data: string) { sent.push(JSON.parse(data)); if (JSON.parse(data).type === 'close') queueMicrotask(() => this.close()); }
    close() { this.readyState = 3; this.onclose?.(); }
    emit(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
  }
  const socket = new Socket(); let microphone: (() => Promise<MediaStream>) = async () => { order.push('microphone'); return stream; };
  const dependencies: ClassroomVoiceClientDependencies = {
    media: () => microphone(),
    socket: url => { assert.equal(url, 'ws://127.0.0.1:8080/ws/classrooms/classroom-1'); order.push('socket'); return socket as unknown as WebSocket; },
    origin: () => 'http://127.0.0.1:8080',
    audio: options => { audioOptions = options; order.push('audio-gesture'); return { startCapture: async () => { captures++; }, playChunk: () => { playback++; }, cancelPlayback: () => { interrupted++; }, mute() {}, resume: async () => {}, close: () => { audioClosed++; } }; },
    startupMs: 200, closeMs: 10,
  };
  const client = new ClassroomVoiceClient({ classroomId: 'classroom-1', provider: 'qwen', onState: state => states.push(state), onSnapshot: snapshot => snapshots.push(snapshot), onLevel() {}, onError: error => errors.push(error) }, dependencies);
  return { client, socket, sent, states, snapshots, errors, order, track, dependencies, setMicrophone: (media: () => Promise<MediaStream>) => { microphone = media; }, get options() { return audioOptions!; }, get tracksStopped() { return tracksStopped; }, get audioClosed() { return audioClosed; }, get captures() { return captures; }, get playback() { return playback; }, get interrupted() { return interrupted; }, stream };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('microphone PCM starts only after server-ready and actual audio drives playback', async () => {
  const h = harness(), starting = h.client.start(); await tick();
  assert.deepEqual(h.order, ['audio-gesture', 'microphone', 'socket']); assert.equal(h.captures, 0);
  h.options.onFrame('AAAA'); assert.equal(h.sent.length, 0);
  h.socket.emit({ type: 'ready', inputSampleRate: 16000, outputSampleRate: 24000 }); await starting;
  assert.equal(h.captures, 1); assert.equal(h.states.at(-1), 'connected');
  h.options.onFrame('AAAA'); assert.equal(h.sent.at(-1)?.type, 'audio');
  h.socket.emit({ type: 'audio', audio: 'AAAA', sampleRate: 24000 }); assert.equal(h.playback, 1);
  h.socket.emit({ type: 'interrupt' }); assert.equal(h.interrupted, 1);
  await h.client.stop(); assert.equal(h.audioClosed, 1); assert.equal(h.tracksStopped, 1);
});

test('stop during a pending microphone request stops the late stream without connecting', async () => {
  const h = harness(); let resolve: ((stream: MediaStream) => void) | undefined;
  h.setMicrophone(() => new Promise<MediaStream>(done => { resolve = done; }));
  const starting = h.client.start(); await h.client.stop(); resolve!(h.stream); await starting;
  assert.equal(h.tracksStopped, 1); assert.equal(h.audioClosed, 1); assert(!h.order.includes('socket')); assert.equal(h.errors.length, 0);
});

test('denied microphone and startup timeout release local audio and never claim connected', async () => {
  const denied = harness(); denied.setMicrophone(async () => { throw new Error('permission denied'); });
  await assert.rejects(denied.client.start()); assert.equal(denied.audioClosed, 1); assert(!denied.states.includes('connected'));
  const h = harness(); const starting = h.client.start(); await assert.rejects(starting); assert.equal(h.tracksStopped, 1); assert.equal(h.audioClosed, 1); assert(!h.states.includes('connected'));
});

test('wrong-rate ready and backpressure fail rather than playing or buffering unbounded audio', async () => {
  const wrong = harness(); const starting = wrong.client.start(); await tick(); wrong.socket.emit({ type: 'ready', inputSampleRate: 24000, outputSampleRate: 24000 }); await assert.rejects(starting); assert.equal(wrong.captures, 0);
  const h = harness(), ready = h.client.start(); await tick(); h.socket.emit({ type: 'ready', inputSampleRate: 16000, outputSampleRate: 24000 }); await ready;
  h.socket.bufferedAmount = 300000; h.options.onFrame('AAAA'); assert.equal(h.states.at(-1), 'error'); assert.equal(h.tracksStopped, 1);
});

test('same-class server snapshots apply; late events after stop cannot restart playback', async () => {
  const h = harness(), ready = h.client.start(); await tick(); h.socket.emit({ type: 'ready', inputSampleRate: 16000, outputSampleRate: 24000 }); await ready;
  h.socket.emit({ type: 'snapshot', classroom: { id: 'classroom-1', revision: 2 } });
  h.socket.emit({ type: 'snapshot', classroom: { id: 'another', revision: 3 } }); assert.equal(h.snapshots.length, 1);
  h.client.setMuted(true); assert.equal(h.track.enabled, false);
  await h.client.stop(); h.socket.emit({ type: 'audio', audio: 'AAAA', sampleRate: 24000 }); assert.equal(h.playback, 0);
  assert.equal(h.client.sendText('late'), false);
});
