import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceBridge, handleVoiceSession, authorizeVoiceUpgrade, openVoiceUpstream, type VoiceServerConfig, type VoiceSocket } from '../lib/voice-bridge.ts';
import { makeLiveTicket, verifyLiveTicket } from '../lib/live-ticket.ts';
import { ApiError } from '../lib/http.ts';
import { createDemoBook } from '../lib/demo.ts';
import type { LiveContext } from '../lib/live-protocol.ts';
import type { VoiceWire } from '../lib/voice-providers/types.ts';

const key = 'unit-only-provider-key', uuid = '11111111-2222-3333-4444-555555555555', userId = 'unit-user';
const config: VoiceServerConfig = { key, model: 'glm-realtime-flash', voice: 'tongtong', workspaceId: 'workspace', region: 'cn-beijing' };
const book = createDemoBook();
const context: LiveContext = { contextKey: 'classroom:apple', lessonTitle: 'Fruit', age: 7, step: book.lessons[0].steps[1], objects: book.pages[0].objects, selectedIds: [], answered: false };
const offer = (direction = 'recvonly') => `v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=${direction}\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n`;
const request = (body: unknown) => new Request('https://littleleaf.test/api/voice/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const deps = { authorize: async () => ({ userId }), config: () => config, uuid: () => uuid };
const immediate = () => new Promise<void>(resolve => setImmediate(resolve));

class FakeSocket implements VoiceSocket {
  sent: VoiceWire[] = []; closes = 0; accepted = false;
  listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();
  send(data: VoiceWire) { this.sent.push(data); }
  close() { this.closes++; }
  accept() { this.accepted = true; }
  addEventListener(type: string, callback: (event: { data?: unknown }) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(callback); }
  removeEventListener(type: string, callback: (event: { data?: unknown }) => void) { this.listeners.get(type)?.delete(callback); }
  emit(type: string, data?: unknown) { for (const callback of [...(this.listeners.get(type) || [])]) callback({ data }); }
  message(data: unknown) { this.emit('message', typeof data === 'string' ? data : JSON.stringify(data)); }
  json() { return this.sent.map(data => JSON.parse(data as string)); }
}
function clock() {
  let now = Date.now(), count = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return { now: () => now, timers,
    setTimeout: (callback: () => void, milliseconds: number) => { const handle = ++count; timers.set(handle, { at: now + milliseconds, callback }); return handle as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => { timers.delete(handle as unknown as number); },
    advance: (milliseconds: number) => { now += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.callback(); },
  };
}
async function relay(mode: 'probe' | 'classroom' = 'classroom', options: { connect?: () => Promise<VoiceSocket>; owner?: string } = {}) {
  const browser = new FakeSocket(), upstream = new FakeSocket(), time = clock(); let connects = 0;
  const sessionId = `voice_glm_${mode}_${uuid}`, ticket = await makeLiveTicket(key, sessionId, userId, time.now());
  const bridge = createVoiceBridge(browser, { ...time, userId: options.owner || userId, config: () => config, connect: async () => { connects++; return options.connect ? options.connect() : upstream; } });
  browser.message({ type: 'voice.open', provider: 'glm', sessionId, ticket, ...(mode === 'classroom' ? { context } : {}) });
  const deadline = performance.now() + 2000;
  while (!connects && !browser.closes && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
  await immediate();
  return { browser, upstream, time, bridge, connects: () => connects, sessionId, ticket };
}

test('voice HTTP session requires authentication, provider config and explicit classroom consent', async () => {
  let calls = 0; const fetcher = async () => { calls++; return new Response(offer()); };
  const denied = await handleVoiceSession(request({ provider: 'glm', mode: 'probe' }), { ...deps, fetch: fetcher, authorize: async () => { throw new ApiError(401, 'Please sign in.'); } });
  assert.equal(denied.status, 401); assert.equal(calls, 0);
  const missing = await handleVoiceSession(request({ provider: 'glm', mode: 'probe' }), { ...deps, config: () => ({ ...config, key: '' }), fetch: fetcher });
  assert.equal(missing.status, 503);
  assert.equal((await handleVoiceSession(request({ provider: 'glm', mode: 'classroom', context }), deps)).status, 400);
  assert.equal((await handleVoiceSession(request({ provider: 'unknown', mode: 'probe' }), deps)).status, 400);
  const response = await handleVoiceSession(request({ provider: 'glm', mode: 'classroom', consent: true, context }), { ...deps, fetch: fetcher });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(calls, 0);
  const body = await response.json() as { transport: string; wsPath: string; sessionId: string; ticket: string; closeToken: string; sdp: string }; assert.equal(body.transport, 'websocket_relay'); assert.equal(body.wsPath, '/api/voice/stream');
  assert.equal(body.closeToken, body.ticket); assert.equal(body.sdp, '');
  assert.equal(body.sessionId, `voice_glm_classroom_${uuid}`); assert(!JSON.stringify(body).includes(key));
  assert(await verifyLiveTicket(key, body.ticket, body.sessionId, userId)); assert(!await verifyLiveTicket(key, body.ticket, body.sessionId, 'another-user'));
});

test('Qwen SDP exchange authenticates only on the server and rejects sending audio in a probe', async () => {
  const qwen = { ...config, model: 'qwen3.8-omni-flash-realtime', voice: 'Tina' }; let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++; assert.equal(String(url), 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${key}`); assert.equal(new Headers(init?.headers).get('content-type'), 'application/sdp'); assert.equal(init?.body, offer());
    return new Response(offer());
  };
  const invalid = await handleVoiceSession(request({ provider: 'qwen', mode: 'probe', sdp: offer('sendrecv') }), { ...deps, config: () => qwen, fetch: fetcher });
  assert.equal(invalid.status, 400); assert.equal(calls, 0);
  const response = await handleVoiceSession(request({ provider: 'qwen', mode: 'probe', sdp: offer() }), { ...deps, config: () => qwen, fetch: fetcher });
  assert.equal(response.status, 200); const body = await response.json() as { sdp: string; transport: string }; assert.equal(body.sdp, offer()); assert.equal(body.transport, 'webrtc_direct'); assert(!JSON.stringify(body).includes(key));
  const failed = await handleVoiceSession(request({ provider: 'qwen', mode: 'probe', sdp: offer() }), { ...deps, config: () => qwen, fetch: async () => new Response(`provider body: ${key}`, { status: 401 }) });
  assert.equal(failed.status, 502); assert(!(await failed.text()).includes(key));
});

test('WebSocket upgrade rejects absent/cross-site Origin before authentication', async () => {
  let auth = 0; const authorize = async () => { auth++; return { userId }; };
  for (const origin of [null, 'https://other.test']) await assert.rejects(authorizeVoiceUpgrade(new Request('https://littleleaf.test/api/voice/stream', { headers: { Upgrade: 'websocket', ...(origin ? { Origin: origin } : {}) } }), authorize), /当前网站/);
  assert.equal(auth, 0);
  await assert.rejects(authorizeVoiceUpgrade(new Request('https://littleleaf.test/api/voice/stream', { headers: { Origin: 'https://littleleaf.test' } }), authorize), /仅接受/);
  assert.deepEqual(await authorizeVoiceUpgrade(new Request('https://littleleaf.test/api/voice/stream', { headers: { Origin: 'https://littleleaf.test', Upgrade: 'websocket' } }), authorize), { userId });
});

test('upstream host and authentication headers are fixed, and failed bodies never escape', async () => {
  const socket = new FakeSocket();
  const fetcher = (id: 'glm' | 'doubao'): typeof fetch => async (url, init) => {
    assert.equal(String(url), id === 'glm' ? 'https://open.bigmodel.cn/api/paas/v4/realtime' : 'https://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue');
    const headers = new Headers(init?.headers); assert.equal(headers.get('upgrade'), 'websocket');
    assert.equal(headers.get(id === 'glm' ? 'authorization' : 'x-api-key'), id === 'glm' ? `Bearer ${key}` : key);
    assert(!String(url).includes(key)); return { status: 101, webSocket: socket } as unknown as Response;
  };
  assert.equal(await openVoiceUpstream('glm', config, fetcher('glm')), socket);
  assert.equal(await openVoiceUpstream('doubao', config, fetcher('doubao')), socket);
  await assert.rejects(openVoiceUpstream('glm', config, async () => new Response(key, { status: 401 })), /^Error: Voice upgrade failed\.$/);
});

test('relay verifies a user-bound ticket before opening any upstream connection', async () => {
  const { browser, upstream, bridge, connects, time } = await relay('classroom', { owner: 'wrong-user' });
  assert.equal(connects(), 0); assert.equal(browser.closes, 1); assert.equal(upstream.sent.length, 0); assert.equal(time.timers.size, 0); bridge.close();
  assert.equal(browser.closes, 1);
});

test('silent probe configures without tools and cannot be promoted to a microphone session', async () => {
  const { browser, upstream, bridge, connects } = await relay('probe');
  assert.equal(connects(), 1); assert.equal(upstream.accepted, true);
  const event = upstream.json()[0]; assert.equal(event.type, 'session.update'); assert.deepEqual(event.session.tools, []); assert.match(event.session.instructions, /Silent connectivity/);
  upstream.message({ type: 'session.updated' }); upstream.message({ type: 'response.audio.delta', delta: 'AQACAA==' });
  assert.deepEqual(browser.json(), [{ type: 'configured' }]);
  browser.message({ type: 'voice.audio', audio: 'AQACAA==' });
  assert.equal(browser.closes, 1); assert.equal(upstream.closes, 1); assert.equal(upstream.sent.length, 1); bridge.close();
});

test('relay reconstructs context, forwards normalized events and pong measures only the website leg', async () => {
  const { browser, upstream, time, bridge } = await relay();
  const initial = upstream.json()[0]; assert.equal(initial.session.tools.length, 3); assert.match(initial.session.instructions, /classroom:apple/);
  upstream.message({ type: 'session.updated' }); upstream.message({ type: 'response.audio.delta', delta: 'AQACAA==' });
  assert.deepEqual(browser.json(), [{ type: 'configured' }, { type: 'audio', audio: 'AQACAA==', sampleRate: 24000 }]);
  browser.message({ type: 'voice.ping', id: 'ping-one' }); assert.deepEqual(browser.json().at(-1), { type: 'voice.pong', id: 'ping-one' });
  browser.message({ type: 'voice.context', context: { ...context, selectedIds: [context.objects[0].id] } });
  assert.equal(upstream.json().at(-1).type, 'session.update'); assert.match(upstream.json().at(-1).session.instructions, /selectedIds/);
  browser.message({ type: 'voice.audio', audio: 'AQACAA==' }); assert.equal(upstream.json().at(-1).type, 'input_audio_buffer.append');
  browser.message({ type: 'voice.close' }); assert.equal(browser.closes, 1); assert.equal(upstream.closes, 1); assert.equal(time.timers.size, 0);
  assert([...browser.listeners.values()].every(values => values.size === 0)); bridge.close();
});

test('bridge authorizes tool results only for tool calls emitted by this session', async () => {
  const { browser, upstream, bridge } = await relay(); upstream.message({ type: 'session.updated' });
  upstream.message({ type: 'response.function_call_arguments.done', event_id: 'tool-one', name: 'highlight_objects', arguments: '{}' });
  upstream.message({ type: 'response.done', response: { status: 'completed' } });
  assert.equal(browser.json().at(-1).type, 'tool');
  // Applying a successful circle changes React state before its async tool result returns.
  browser.message({ type: 'voice.context', context: { ...context, answered: true } });
  browser.message({ type: 'voice.tool_result', callId: 'tool-one', output: '{"ok":true}' });
  assert.equal(upstream.json().at(-2).item.type, 'function_call_output');
  const sent = upstream.sent.length;
  browser.message({ type: 'voice.tool_result', callId: 'tool-one', output: '{"ok":true}' }); assert.equal(upstream.sent.length, sent); assert.equal(browser.closes, 0); bridge.close();
});

test('relay discards duplicate provider acknowledgement events before consuming browser context acknowledgements', async () => {
  const { browser, upstream, bridge } = await relay();
  upstream.message({ type: 'session.updated', event_id: 'same-ack' }); upstream.message({ type: 'session.updated', event_id: 'same-ack' });
  assert.deepEqual(browser.json(), [{ type: 'configured' }]);
  browser.message({ type: 'voice.context', context });
  upstream.message({ type: 'session.updated', event_id: 'next-ack' }); assert.equal(browser.json().length, 2); bridge.close();
});

test('first-message, connection and server session deadlines close and clean both sides', async () => {
  const browser = new FakeSocket(), time = clock(); let connects = 0;
  createVoiceBridge(browser, { ...time, userId, config: () => config, connect: async () => { connects++; return new FakeSocket(); } });
  time.advance(5000); assert.equal(browser.closes, 1); assert.equal(connects, 0); assert.equal(time.timers.size, 0);
  const current = await relay(); current.time.advance(600_000); assert.equal(current.browser.closes, 1); assert.equal(current.upstream.closes, 1); assert.equal(current.time.timers.size, 0);
  let resolve!: (socket: VoiceSocket) => void;
  const pending = await relay('classroom', { connect: () => new Promise(done => { resolve = done; }) });
  pending.time.advance(15_000); assert.equal(pending.browser.closes, 1);
  const late = new FakeSocket(); resolve(late); await immediate(); assert.equal(late.closes, 1); assert.equal(pending.time.timers.size, 0);
});

test('oversized, binary, malformed and excessive messages never keep an unbounded bridge alive', async () => {
  for (const raw of ['not-json', 'x'.repeat(65_537), new Uint8Array([1, 2])]) {
    const browser = new FakeSocket(), time = clock(); let connects = 0;
    createVoiceBridge(browser, { ...time, userId, config: () => config, connect: async () => { connects++; return new FakeSocket(); } });
    browser.emit('message', raw); await immediate(); assert.equal(browser.closes, 1); assert.equal(connects, 0); assert.equal(time.timers.size, 0);
  }
  const current = await relay(); current.upstream.message({ type: 'session.updated' });
  for (let i = 0; i < 101; i++) current.browser.message({ type: 'voice.ping', id: 'ping' });
  assert.equal(current.browser.closes, 1); assert.equal(current.browser.json().at(-1).code, 'message_rate');
  const audio = await relay(); audio.upstream.message({ type: 'session.updated' });
  for (let i = 0; i < 21; i++) audio.browser.message({ type: 'voice.audio', audio: 'AAAA'.repeat(800) });
  assert.equal(audio.browser.closes, 1); assert.equal(audio.browser.json().at(-1).code, 'audio_rate');
});
