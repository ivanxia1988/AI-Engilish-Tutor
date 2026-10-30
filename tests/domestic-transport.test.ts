import test from 'node:test';
import assert from 'node:assert/strict';
import { DomesticVoiceTransport, type DomesticDependencies, type DomesticSession } from '../lib/domestic-voice-transport.ts';
import type { LiveContext } from '../lib/live-protocol.ts';
import { createDemoBook } from '../lib/demo.ts';
import { LiveClassroomClient } from '../lib/live-client.ts';

const book = createDemoBook();
const context: LiveContext = { contextKey: 'original-task-unique', lessonTitle: 'Fruit practice', age: 7, step: book.lessons[0].steps[1], objects: book.pages[0].objects, selectedIds: [], answered: false };
const SDP = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
const session: DomesticSession = { sessionId: 'synthetic_domestic', sdp: SDP, closeToken: 'synthetic-close', ticket: 'synthetic-ticket', provider: 'qwen', model: 'qwen3.8-omni-flash-realtime', voice: 'Tina', transport: 'webrtc_direct' };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
type Wire = Record<string, any>;
class Channel {
  readyState = 'open'; onmessage: ((event: { data: string }) => void) | null = null; onclose: (() => void) | null = null;
  sent: Wire[] = []; autoAck = false;
  constructor(readonly label: string) {}
  send(raw: string) { const value = JSON.parse(raw); this.sent.push(value); if (this.autoAck && value.type === 'session.update') this.receive({ type: 'session.updated', session: {} }); }
  receive(value: Wire) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close() { this.readyState = 'closed'; this.onclose?.(); }
}
class Peer {
  client = new Channel('oai-events'); server = new Channel('txt');
  iceGatheringState = 'complete'; connectionState = 'new'; localDescription: { type?: string; sdp: string } | null = null;
  ondatachannel: ((event: { channel: Channel }) => void) | null = null; onconnectionstatechange: (() => void) | null = null; ontrack: unknown = null;
  transceivers: { kind: string; direction: string }[] = []; attachments: unknown[] = []; remoteCalls = 0; closed = 0;
  remoteHook?: () => void;
  listeners = new Map<string, Set<() => void>>();
  sender = { replaceTrack: async (track: unknown) => { this.attachments.push(track); } };
  addTransceiver(kind: string, options: { direction: string }) { this.transceivers.push({ kind, direction: options.direction }); return { sender: this.sender }; }
  createDataChannel() { return this.client; }
  async createOffer() { return { type: 'offer', sdp: SDP }; }
  async setLocalDescription(value: { type?: string; sdp: string }) { this.localDescription = value; }
  async setRemoteDescription() { this.remoteCalls++; this.connectionState = 'connected'; this.onconnectionstatechange?.(); this.remoteHook?.(); }
  addEventListener(name: string, callback: () => void) { const set = this.listeners.get(name) || new Set(); set.add(callback); this.listeners.set(name, set); }
  removeEventListener(name: string, callback: () => void) { this.listeners.get(name)?.delete(callback); }
  completeIce() { this.iceGatheringState = 'complete'; this.listeners.get('icegatheringstatechange')?.forEach(callback => callback()); }
  serverChannel() { this.ondatachannel?.({ channel: this.server }); return this.server; }
  async getStats() { return new Map(); }
  close() { this.closed++; this.connectionState = 'closed'; }
}
function harness(overrides: Partial<DomesticDependencies> = {}) {
  const peer = new Peer(), events: Wire[] = [], errors: string[] = [], requests: { path: string; body: Wire }[] = [];
  let captures = 0, trackStops = 0, audioFactories = 0;
  const track = { enabled: true, stop: () => { trackStops++; } };
  const media = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const deps: DomesticDependencies = {
    request: async <T>(path: string, body: unknown) => { requests.push({ path, body: body as Wire }); return session as T; },
    media: async () => { captures++; return media; }, peer: () => peer as unknown as RTCPeerConnection,
    socket: () => { throw new Error('Qwen must not open the website PCM relay.'); },
    audio: () => { audioFactories++; return { paused: false, play: async () => {}, pause() {}, srcObject: null } as unknown as HTMLAudioElement; },
    now: () => 1000, ...overrides,
  };
  const transport = new DomesticVoiceTransport('qwen', { event: event => events.push(event), level() {}, error: message => errors.push(message) }, deps);
  const send = (event: Wire) => transport.channel.send(JSON.stringify(event));
  const ready = async () => { const channel = peer.serverChannel(); channel.receive({ type: 'session.created', session: { id: 'qwen_synthetic' } }); channel.receive({ type: 'session.updated', session: {} }); await tick(); return channel; };
  return { transport, deps, peer, events, errors, requests, media, track, send, ready, captures: () => captures, trackStops: () => trackStops, audioFactories: () => audioFactories };
}

test('Qwen binds the server txt channel and attaches microphone only after configuration acknowledgement', async t => {
  const h = harness(); t.after(() => h.transport.dispose());
  await h.transport.start('classroom', context);
  assert.deepEqual(h.peer.transceivers, [{ kind: 'audio', direction: 'sendrecv' }]);
  assert.equal(h.captures(), 1); assert.equal(h.peer.attachments.length, 0);
  const server = h.peer.serverChannel(); server.receive({ type: 'session.created', session: { id: 'created_on_txt' } });
  assert.equal(server.sent.length, 1); assert.equal(server.sent[0].type, 'session.update');
  assert.equal(h.peer.client.sent.length, 0); assert.equal(h.peer.attachments.length, 0);
  assert(!h.events.some(event => event.type === 'session.started'));
  server.receive({ type: 'session.updated', session: {} }); await tick();
  assert.deepEqual(h.peer.attachments, [h.track]);
  assert.equal(h.events.filter(event => event.type === 'session.started').length, 1);
  assert.equal(h.transport.channel.readyState, 'open'); assert.deepEqual(h.errors, []);
});

test('Qwen context updates are acknowledged in order and generated speech waits for its own update acknowledgement', async t => {
  const h = harness(); t.after(() => h.transport.dispose());
  await h.transport.start('classroom', context); const server = await h.ready();
  h.transport.setContext({ ...context, contextKey: 'new-task-unique' });
  h.send({ type: 'session.thinking.append', event_id: 'context_one', content: 'First state' });
  h.send({ type: 'session.commentary.append', event_id: 'cue_one', content: 'Ask the learner to point to the apple.' });
  assert.equal(server.sent.filter(event => event.type === 'session.update').length, 2);
  const latestInstructions = server.sent.filter(event => event.type === 'session.update').at(-1)!.session.instructions as string;
  assert(latestInstructions.includes('new-task-unique'));
  assert(latestInstructions.includes('Never request personal information'));
  assert(!latestInstructions.includes('original-task-unique'));
  assert(!server.sent.some(event => event.type === 'response.create'));
  server.receive({ type: 'session.updated', session: {} });
  assert(h.events.some(event => event.type === 'session.thinking.appended' && event.client_event_id === 'context_one'));
  assert.equal(server.sent.filter(event => event.type === 'session.update').length, 3);
  assert(!server.sent.some(event => event.type === 'response.create'));
  server.receive({ type: 'session.updated', session: {} });
  assert.equal(server.sent.filter(event => event.type === 'response.create').length, 1);
  assert(!server.sent.some(event => event.type === 'input_audio_buffer.commit'));
});

test('superseded queued context updates are all acknowledged only once the newest complete state is applied', async t => {
  const h = harness(); t.after(() => h.transport.dispose());
  await h.transport.start('classroom', context); const server = await h.ready();
  for (const suffix of ['one', 'two', 'three']) h.send({ type: 'session.thinking.append', event_id: `context_${suffix}`, content: `State ${suffix}` });
  assert.equal(server.sent.filter(event => event.type === 'session.update').length, 2);
  server.receive({ type: 'session.updated', session: {} });
  const beforeNewestAck = h.events.filter(event => event.type === 'session.thinking.appended').map(event => event.client_event_id);
  assert.deepEqual(beforeNewestAck, ['context_one']);
  assert.equal(server.sent.filter(event => event.type === 'session.update').length, 3);
  server.receive({ type: 'session.updated', session: {} });
  const ackIds = h.events.filter(event => event.type === 'session.thinking.appended').map(event => event.client_event_id);
  assert.equal(ackIds.length, 3); assert.deepEqual(new Set(ackIds), new Set(['context_one', 'context_two', 'context_three']));
});

test('duplicate events across Qwen channels cannot switch the event channel or falsely acknowledge a later update', async t => {
  const h = harness(); t.after(() => h.transport.dispose());
  await h.transport.start('classroom', context);
  const server = h.peer.serverChannel();
  const created = { type: 'session.created', event_id: 'created_one', session: { id: 'qwen_one' } };
  server.receive(created); server.receive({ type: 'session.updated', event_id: 'configured_initial', session: {} }); await tick();
  h.peer.client.receive(created);
  h.send({ type: 'session.thinking.append', event_id: 'state_one', content: 'One' });
  h.send({ type: 'session.thinking.append', event_id: 'state_two', content: 'Two' });
  assert.equal(h.peer.client.sent.length, 0);
  const firstAck = { type: 'session.updated', event_id: 'configured_state_one', session: {} };
  server.receive(firstAck); h.peer.client.receive(firstAck);
  assert.deepEqual(h.events.filter(event => event.type === 'session.thinking.appended').map(event => event.client_event_id), ['state_one']);
  server.receive({ type: 'session.updated', event_id: 'configured_state_two', session: {} });
  assert.deepEqual(h.events.filter(event => event.type === 'session.thinking.appended').map(event => event.client_event_id), ['state_one', 'state_two']);
});

test('final ASR events are delivered once per item and partial ASR cannot execute classroom commands', async t => {
  const h = harness(); t.after(() => h.transport.dispose());
  await h.transport.start('classroom', context); const server = await h.ready();
  server.receive({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'child_one', text: '', stash: 'Circle the app' });
  server.receive({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'child_one', text: 'Circle the ', stash: 'apple' });
  assert(!h.events.some(event => event.type === 'session.input_transcript.delta'));
  for (let n = 0; n < 2; n++) server.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'child_one', transcript: 'Circle the apple.' });
  server.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'child_two', transcript: 'Circle the apple.' });
  const transcripts = h.events.filter(event => event.type === 'session.input_transcript.delta');
  assert.equal(transcripts.length, 2); assert(transcripts.every(event => event.delta === 'Circle the apple.' && event.final === true));
});

test('Qwen receive-only probe never captures or sends microphone audio, speech requests, or tools', async t => {
  const h = harness(); t.after(() => h.transport.dispose());
  await h.transport.start('probe'); const server = await h.ready();
  assert.equal(h.captures(), 0); assert.equal(h.audioFactories(), 0); assert.equal(h.peer.attachments.length, 0);
  assert.deepEqual(h.peer.transceivers, [{ kind: 'audio', direction: 'recvonly' }]);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].body.mode, 'probe'); assert(!('consent' in h.requests[0].body));
  assert.equal(server.sent.length, 1); assert.deepEqual(server.sent[0].session.tools, []);
  assert(server.sent[0].session.instructions.includes('Silent connectivity check'));
  assert(!server.sent.some(event => /response.create|input_audio_buffer.append/.test(event.type)));
});

test('closing while microphone permission is pending stops a late stream without creating a session', async t => {
  let accept!: (stream: MediaStream) => void;
  const h = harness({ media: () => new Promise(resolve => { accept = resolve; }) }); t.after(() => h.transport.dispose());
  const pending = h.transport.start('classroom', context);
  h.transport.requestClose(); accept(h.media);
  await assert.rejects(pending, /取消/);
  assert.equal(h.requests.length, 0); assert.equal(h.trackStops(), 1); assert.equal(h.transport.channel.readyState, 'closed');
});

test('closing during ICE gathering never creates a paid session after a late ICE completion', async t => {
  const h = harness(); t.after(() => h.transport.dispose()); h.peer.iceGatheringState = 'gathering';
  const pending = h.transport.start('classroom', context); await tick();
  assert.equal(h.requests.length, 0); h.transport.requestClose(); h.peer.completeIce();
  await assert.rejects(pending, /取消/);
  assert.equal(h.requests.length, 0); assert.equal(h.peer.remoteCalls, 0);
});

test('closing during the server request discards late answers and cannot reopen media or deliver transcripts', async t => {
  let accept!: (session: DomesticSession) => void;
  const h = harness({ request: async <T>() => await new Promise<DomesticSession>(resolve => { accept = resolve; }) as T }); t.after(() => h.transport.dispose());
  const pending = h.transport.start('classroom', context); await tick();
  const server = h.peer.serverChannel(); h.transport.requestClose(); accept(session);
  await assert.rejects(pending, /取消/);
  server.receive({ type: 'session.created', session: { id: 'late' } });
  server.receive({ type: 'session.updated' });
  server.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'late-child', transcript: 'Circle the apple.' });
  assert.equal(h.peer.remoteCalls, 0); assert.equal(h.peer.attachments.length, 0); assert.equal(h.trackStops(), 1);
  assert(!h.events.some(event => event.type === 'session.started' || event.type === 'session.input_transcript.delta'));
});

test('a synchronously initialized probe does not acquire a new initialization timeout after it is ready', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); t.after(() => { h.transport.dispose(); t.mock.timers.reset(); });
  h.peer.remoteHook = () => { const server = h.peer.serverChannel(); server.autoAck = true; server.receive({ type: 'session.created', session: { id: 'sync_probe' } }); };
  await h.transport.start('probe');
  assert.equal(h.transport.channel.readyState, 'open');
  t.mock.timers.tick(26_000);
  assert.deepEqual(h.errors, []); assert.equal(h.transport.channel.readyState, 'open');
});

test('native tool arguments for an old task are rejected before execution and a late result cannot announce success', async t => {
  const h = harness(); const toolCalls: string[] = [], states: string[] = [];
  let finish!: (value: unknown) => void;
  const client = new LiveClassroomClient({ state: value => states.push(value), error: message => h.errors.push(message), tool: call => { toolCalls.push(call.call_id); return new Promise(resolve => { finish = resolve; }); } }, h.deps, 'qwen');
  t.after(() => { client.dispose(); h.transport.dispose(); });
  await client.start('classroom', context); const server = await h.ready();
  let ackedUpdates = 1;
  const acknowledgePendingUpdates = () => {
    for (let limit = 0; limit < 20 && server.sent.filter(event => event.type === 'session.update').length > ackedUpdates; limit++) {
      ackedUpdates++; server.receive({ type: 'session.updated', event_id: `tool_test_ack_${ackedUpdates}`, session: {} });
    }
  };
  acknowledgePendingUpdates(); await tick(); assert(states.includes('connected'));
  server.receive({ type: 'response.function_call_arguments.done', call_id: 'old_tool', name: 'highlight_objects', arguments: JSON.stringify({ contextKey: 'previous-task', objectIds: ['apple'] }) });
  await tick(); assert.equal(toolCalls.length, 0);
  const rejected = server.sent.find(event => event.type === 'conversation.item.create' && event.item.call_id === 'old_tool');
  assert(rejected); assert.equal(JSON.parse(rejected.item.output).status, 'failed');
  const matching = { type: 'response.function_call_arguments.done', call_id: 'slow_tool', name: 'highlight_objects', arguments: JSON.stringify({ contextKey: context.contextKey, objectIds: ['apple'] }) };
  server.receive(matching); server.receive(matching); await tick();
  assert.deepEqual(toolCalls, ['slow_tool']);
  client.updateContext({ ...context, contextKey: 'new-task-unique' });
  finish({ status: 'confirmed', rendered: 'circle' }); await tick();
  assert(!server.sent.some(event => event.type === 'conversation.item.create' && event.item.call_id === 'slow_tool'));
  acknowledgePendingUpdates(); await tick();
  const staleResult = server.sent.find(event => event.type === 'conversation.item.create' && event.item.call_id === 'slow_tool');
  assert(staleResult); assert.equal(JSON.parse(staleResult.item.output).status, 'failed');
  assert(!JSON.stringify(staleResult.item.output).includes('confirmed'));
});
