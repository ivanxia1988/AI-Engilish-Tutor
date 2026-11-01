import assert from 'node:assert/strict';
import test from 'node:test';
import { ClassroomVoiceClient, type ClassroomVoiceClientDependencies } from '../lib/classroom-voice-client';
import type { ClassroomSnapshot } from '../lib/classroom-contract';
import type { PcmVoiceAudioOptions } from '../lib/voice-audio';

function harness() {
  let now=0;const connections:import('../lib/classroom-connection').ClassroomConnectionUpdate[]=[];
  const sent: Record<string, unknown>[] = [], states: string[] = [], snapshots: ClassroomSnapshot[] = [], errors: string[] = [], failures: unknown[] = [], queues: number[] = [], order: string[] = [], vision:import('../lib/classroom-vision').ClassroomVisionState[]=[];
  let frameCallback:((image:string)=>void)|undefined,framesStarted=0,framesStopped=0;
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
    startupMs: 200, closeMs: 10, now:()=>now,
    frames:()=>({start:(_stream,onFrame)=>{framesStarted++;frameCallback=onFrame;},stop:()=>{framesStopped++;}}),
  };
  const client = new ClassroomVoiceClient({ classroomId: 'classroom-1', provider: 'qwen', onState: state => states.push(state), onSnapshot: snapshot => snapshots.push(snapshot), onLevel() {}, onError: error => errors.push(error), onFailure: failure => failures.push(failure), onPlaybackQueue: ms => queues.push(ms),onVisionState:value=>vision.push(value),onConnectionQuality:value=>connections.push(value) }, dependencies);
  return { client, socket, sent, states, snapshots, errors, failures, queues, order, track, dependencies,vision,connections,advance:(ms:number)=>{now+=ms;},frame:(image:string)=>frameCallback?.(image),get framesStarted(){return framesStarted;},get framesStopped(){return framesStopped;},setMicrophone: (media: () => Promise<MediaStream>) => { microphone = media; }, get options() { return audioOptions!; }, get tracksStopped() { return tracksStopped; }, get audioClosed() { return audioClosed; }, get captures() { return captures; }, get playback() { return playback; }, get interrupted() { return interrupted; }, stream };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('camera sharing is explicit, generation scoped and never claims understanding before server state',async()=>{
 const h=harness();assert.equal(h.client.startVision(h.stream),false);const pending=h.client.start();await tick();h.socket.emit({type:'ready',inputSampleRate:16000,outputSampleRate:24000});await pending;
 assert.equal(h.framesStarted,0);assert.equal(h.client.startVision(h.stream),true);assert.equal(h.vision.at(-1)?.status,'starting');
 const generation=h.sent.find(event=>event.type==='vision.start')!.generation;h.frame('/9j/4A==');assert.equal(h.vision.at(-1)?.status,'starting');
 assert.deepEqual(h.sent.find(event=>event.type==='vision.frame'),{type:'vision.frame',generation,sequence:1,image:'/9j/4A=='});
 h.socket.emit({type:'vision.state',generation,status:'sharing'});assert.equal(h.vision.at(-1)?.status,'sharing');
 h.client.stopVision();h.frame('/9j/4A==');assert.equal(h.vision.at(-1)?.status,'off');h.socket.emit({type:'vision.state',generation,status:'sharing'});assert.equal(h.vision.at(-1)?.status,'off');
 h.client.startVision(h.stream);h.socket.emit({type:'vision.state',generation,status:'sharing'});assert.equal(h.vision.at(-1)?.status,'starting');await h.client.stop();assert.equal(h.vision.at(-1)?.status,'off');assert.equal(h.audioClosed,1);
});
test('visual backpressure and unsafe server error stop only images, preserving voice',async()=>{
 const h=harness(),pending=h.client.start();await tick();h.socket.emit({type:'ready',inputSampleRate:16000,outputSampleRate:24000});await pending;
 h.client.startVision(h.stream);h.socket.bufferedAmount=1;h.frame('/9j/4A==');assert(!h.sent.some(event=>event.type==='vision.frame'));assert.equal(h.audioClosed,0);assert.equal(h.states.at(-1),'connected');
 h.socket.bufferedAmount=0;h.client.stopVision();h.client.startVision(h.stream);const generation=h.sent.filter(event=>event.type==='vision.start').at(-1)!.generation;
 h.socket.emit({type:'vision.state',generation,status:'error',message:'PRIVATE_UPSTREAM_ERROR'});assert.equal(h.vision.at(-1)?.status,'error');assert(!JSON.stringify(h.vision).includes('PRIVATE'));assert.equal(h.client.sendText('still talking'),true);h.client.dispose();
});
test('missing visual acknowledgement times out without closing the voice connection',async t=>{
 const h=harness();t.mock.timers.enable({apis:['setTimeout','setInterval']});
 try{const pending=h.client.start();await Promise.resolve();h.socket.emit({type:'ready',inputSampleRate:16000,outputSampleRate:24000});await pending;h.client.startVision(h.stream);t.mock.timers.tick(15000);assert.equal(h.vision.at(-1)?.status,'error');assert.equal(h.audioClosed,0);assert.equal(h.client.sendText('voice continues'),true);}finally{h.client.dispose();t.mock.timers.reset();}
});

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

test('server failure codes reach the UI safely and cannot expose arbitrary upstream text', async () => {
  const h = harness(), starting = h.client.start(); await tick(); h.socket.emit({ type: 'ready', inputSampleRate: 16000, outputSampleRate: 24000 }); await starting;
  h.socket.emit({ type: 'error', code: 'response_timeout', message: 'PRIVATE_UPSTREAM_DETAIL' });
  assert.equal(h.states.at(-1), 'error'); assert.equal((h.failures[0] as { code: string }).code, 'response_timeout');
  assert(!JSON.stringify(h.failures).includes('PRIVATE_UPSTREAM_DETAIL')); assert(!JSON.stringify(h.errors).includes('PRIVATE_UPSTREAM_DETAIL'));
  assert.equal(h.audioClosed, 1); assert.equal(h.tracksStopped, 1);
});

test('actual playback queue is forwarded and is reset on release without claiming a network packet was speech', async () => {
  const h = harness(), starting = h.client.start(); await tick(); h.socket.emit({ type: 'ready', inputSampleRate: 16000, outputSampleRate: 24000 }); await starting;
  h.socket.emit({ type: 'audio', audio: 'AAAA', sampleRate: 24000 }); assert.deepEqual(h.queues, []);
  h.options.onQueue?.(230); assert.equal(h.queues.at(-1), 230);
  await h.client.stop(); assert.equal(h.queues.at(-1), 0);
  h.options.onQueue?.(500); assert.equal(h.queues.at(-1), 0);
});


test('browser connection quality uses matching ping RTT and teacher measurements remain a separate link',async()=>{
 const h=harness(),starting=h.client.start();await tick();h.socket.emit({type:'ready',inputSampleRate:16000,outputSampleRate:24000});await starting;
 const ping=h.sent.find(event=>event.type==='ping');assert(ping&&typeof ping.nonce==='string');
 h.advance(480);h.socket.emit({type:'pong',nonce:'stale'});assert.equal(h.connections.filter(item=>item.link==='device').at(-1)?.quality.status,'checking');
 h.socket.emit({type:'pong',nonce:ping.nonce});assert.deepEqual(h.connections.at(-1),{link:'device',quality:{status:'fair',rttMs:480}});
 h.socket.emit({type:'connection.quality',link:'teacher',quality:{status:'good',rttMs:30}});assert.deepEqual(h.connections.at(-1),{link:'teacher',quality:{status:'good',rttMs:30}});
 const before=h.connections.length;h.socket.emit({type:'connection.quality',link:'device',quality:{status:'good',rttMs:1}});h.socket.emit({type:'connection.quality',link:'teacher',quality:{status:'good',rttMs:-4}});assert.equal(h.connections.length,before);
 h.client.dispose();assert.deepEqual(h.connections.slice(-2),[{link:'device',quality:{status:'unavailable',rttMs:null}},{link:'teacher',quality:{status:'unavailable',rttMs:null}}]);
 h.socket.emit({type:'connection.quality',link:'teacher',quality:{status:'good',rttMs:1}});assert.equal(h.connections.at(-1)?.quality.status,'unavailable');
});
test('connection probe timeout reports poor without stopping voice and disposal clears probe timers',async t=>{
 const h=harness();t.mock.timers.enable({apis:['setTimeout','setInterval']});
 try{
  const starting=h.client.start();await Promise.resolve();h.socket.emit({type:'ready',inputSampleRate:16000,outputSampleRate:24000});await starting;
  h.advance(8000);t.mock.timers.tick(8000);assert.deepEqual(h.connections.filter(item=>item.link==='device').at(-1)?.quality,{status:'poor',rttMs:null});
  assert.equal(h.states.at(-1),'connected');assert.equal(h.client.sendText('still talking'),true);
  h.client.dispose();const count=h.sent.length;t.mock.timers.tick(20000);assert.equal(h.sent.length,count);
 }finally{h.client.dispose();t.mock.timers.reset();}
});
