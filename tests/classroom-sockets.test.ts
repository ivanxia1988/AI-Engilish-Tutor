import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { attachClassroomSockets, type VoiceLease } from '../lib/server/classroom-sockets';
import type { ClassroomSnapshot } from '../lib/classroom-contract';
import { refreshClassroom } from '../lib/server/classroom-events';
import type { PcmOutputClock } from '../lib/server/classroom-audio';
import type {ClassroomVisionObserver} from '../lib/classroom-vision';

const id = '6e98bb60-4ed0-4c64-bcbc-174d5dcb26c2';
const snapshot = { id, revision: 1, stepIndex: 0, connectionEpoch: 1, status: 'active', preferences: { voice: 'female' }, teacherObjectIds: [], feedback: null,
  course: { id: 'picnic', version: '1', title: 'Picnic', pages: [{ id: 'page-1', objects: [{ id: 'apple', label: 'apple', chinese: '苹果' }] }], steps: [{ id: 'find-apple', kind: 'select', pageId: 'page-1', english: 'Find the apple.' }, { id: 'say-banana', kind: 'speak', pageId: 'page-1', english: 'Say the banana.' }] },
} as unknown as ClassroomSnapshot;
const waitFor = async (condition: () => boolean) => {
  const end = Date.now() + 2000;
  while (!condition()) { if (Date.now() >= end) throw new Error('Expected socket event did not arrive.'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
async function harness(provider: 'qwen' | 'openai' = 'qwen', extra: { remainingMs?: number; startupMs?: number; autoReady?: boolean; delayedTool?: boolean; voice?: string; startedFails?: boolean; delayedTranscript?: boolean; delayedResponses?: boolean; responseAckMs?: number; instructions?: string; spokenResult?: string; heartbeatMs?: number; refreshOnTranscript?: boolean; refreshOnTool?: boolean; audioClock?: PcmOutputClock; gptOutputQuietMs?: number; gptOutputWaitMs?: number; contextVersion?: string; observe?:ClassroomVisionObserver } = {}) {
  const upstreamHttp = createServer(), vendor = new WebSocketServer({ server: upstreamHttp });
  const sent: Record<string, unknown>[] = [], downstream: Record<string, unknown>[] = [], transcripts: unknown[] = [], tools: unknown[] = [];
  let upstream: WebSocket | undefined, opened = 0, released = 0, heartbeatAllowed = true, current = snapshot, resolveTool: (() => void) | undefined, resolveTranscript: (() => void) | undefined, persistedStarts = 0;
  let heartbeatCalls = 0, delayHeartbeat = false, releaseHeartbeat: (() => void) | undefined;
  vendor.on('connection', socket => {
    upstream = socket;
    socket.on('message', data => {
      const event = JSON.parse(data.toString()); sent.push(event);
      if (extra.autoReady === false) return;
      if (provider === 'qwen' && event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
      if (provider === 'qwen' && event.type === 'response.create' && !extra.delayedResponses) {
        socket.send(JSON.stringify({ type: 'response.created' })); socket.send(JSON.stringify({ type: 'response.done' }));
      }
      if (provider === 'openai' && event.type === 'session.start') socket.send(JSON.stringify({ type: 'session.started', session: { id: 'voice_session' } }));
      if (event.type === 'session.close') socket.send(JSON.stringify({ type: 'session.closed' }));
    });
    if (provider === 'qwen') socket.send(JSON.stringify({ type: 'session.created', session: { id: 'voice_session' } }));
  });
  upstreamHttp.listen(0, '127.0.0.1'); await once(upstreamHttp, 'listening');
  const vendorAddress = upstreamHttp.address(); assert(vendorAddress && typeof vendorAddress !== 'string');
  const app = createServer();
  const lease: VoiceLease = {
    id, epoch: 1, provider, instructions: 'Current verified task: find apple.', initialCue: 'Can you find the apple?', remainingMs: extra.remainingMs ?? 60000, snapshot, observe:extra.observe, ...(extra.voice ? { voice: extra.voice } : {}),
    async heartbeat() {
      heartbeatCalls++; const captured = current;
      if (delayHeartbeat) { delayHeartbeat = false; await new Promise<void>(resolve => { releaseHeartbeat = resolve; }); }
      return heartbeatAllowed ? { snapshot: captured, instructions: extra.instructions ?? captured.feedback?.message ?? 'Current verified task: say apple.' } : null;
    },
    async started(sessionId) { assert.equal(sessionId, 'voice_session'); if (extra.startedFails) throw new Error('fixture persistence unavailable'); persistedStarts++; },
    async transcript(event) {
      if (extra.delayedTranscript) await new Promise<void>(resolve => { resolveTranscript = resolve; }); transcripts.push(event);
      if (extra.refreshOnTranscript) { current = { ...snapshot, revision: 2, stepIndex: 1 }; await refreshClassroom(id); }
    },
    async tool(name, args) { tools.push({ name, args, finalEvidence: transcripts.filter(event => (event as { final?: boolean }).final) }); if (extra.delayedTool) await new Promise<void>(resolve => { resolveTool = resolve; }); if (extra.refreshOnTool) { current = { ...current, revision: current.revision + 1, teacherObjectIds: ['apple'], feedback: { id: 'tool-feedback', kind: 'hint', message: '老师标出了图案。' } }; await refreshClassroom(id); } return { output: { status: 'confirmed', english: extra.spokenResult ?? 'The application confirms the selected apple.' }, snapshot: current }; },
    async closed() { released++; },
  };
  const controller = attachClassroomSockets(app, {
    origin: 'http://localhost:8080',
    open: async () => { opened++; return lease; },
    config: () => ({ key: 'non-production-fixture', model: provider === 'qwen' ? 'qwen3.8-omni-flash-realtime' : 'gpt-live-1', voice: 'Tina', workspaceId: 'workspace', region: 'cn-beijing', childDataReady: true }),
    connect: () => new WebSocket(`ws://127.0.0.1:${vendorAddress.port}`),
    heartbeatMs: extra.heartbeatMs ?? 25, startupMs: extra.startupMs ?? 1000, closeMs: 30, utteranceSettleMs: 20, responseAckMs: extra.responseAckMs ?? 1000,
    audioClock: extra.audioClock,
    gptOutputQuietMs: extra.gptOutputQuietMs, gptOutputWaitMs: extra.gptOutputWaitMs,
  });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const address = app.address(); assert(address && typeof address !== 'string');
  const connect = (origin = 'http://localhost:8080', cookie = `teeko_session=${'t'.repeat(43)}`) => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/classrooms/${id}`, { headers: { Origin: origin, Cookie: cookie } });
    socket.on('error', () => {});
    socket.on('message', data => downstream.push(JSON.parse(data.toString())));
    return socket;
  };
  return { connect, sent, downstream, transcripts, tools, get opened() { return opened; }, get released() { return released; }, get persistedStarts() { return persistedStarts; }, get upstream() { return upstream; }, get heartbeatCalls() { return heartbeatCalls; },get transcriptWaiting(){return !!resolveTranscript;}, delayNextHeartbeat: () => { delayHeartbeat = true; }, releaseHeartbeat: () => releaseHeartbeat?.(), revoke: () => { heartbeatAllowed = false; }, resolveTool: () => resolveTool?.(), resolveTranscript: () => resolveTranscript?.(), advance: () => { current = { ...snapshot, revision: 2, stepIndex: 1, course: { ...snapshot.course, version: extra.contextVersion ?? snapshot.course.version } }; }, feedback: (message = 'Try once more.') => { current = { ...current, revision: current.revision + 1, feedback: { id: `feedback_${current.revision + 1}`, kind: 'retry', message } }; }, async close() { await controller.close(); for (const socket of vendor.clients) socket.terminate(); await new Promise<void>(resolve => vendor.close(() => resolve())); await new Promise<void>(resolve => upstreamHttp.close(() => resolve())); await new Promise<void>(resolve => app.close(() => resolve())); } };
}

function pcmFrame(voiced: boolean) {
  const audio = Buffer.alloc(4800);
  if (voiced) for (let i = 0; i < 2400; i++) audio.writeInt16LE(i % 2 ? 1500 : -1500, i * 2);
  return JSON.stringify({ type: 'audio', audio: audio.toString('base64') });
}
function finishSpokenInput(socket: WebSocket) { for (let i = 0; i < 12; i++) socket.send(pcmFrame(false)); }

test('wrong Origin and missing account Cookie cannot claim a lease or create an upstream', async () => {
  const h = await harness();
  try {
    for (const [origin, cookie, expected] of [['https://other.example', '', 403], ['http://localhost:8080', '', 401]] as const) {
      const socket = h.connect(origin, cookie);
      const [, response] = await once(socket, 'unexpected-response');
      assert.equal(response.statusCode, expected); response.resume(); socket.terminate();
      assert.equal(h.opened, 0); assert.equal(h.sent.length, 0);
    }
  } finally { await h.close(); }
});

test('Qwen is configured before ready; only paced PCM enters upstream and raw commands are rejected', async () => {
  const h = await harness();
  try {
    const socket = h.connect(); await once(socket, 'open');
    await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    assert.equal(h.persistedStarts, 1);
    assert.equal(h.sent[0].type, 'session.update');
    socket.send(JSON.stringify({ type: 'audio', audio: Buffer.alloc(3200).toString('base64') }));
    await waitFor(() => h.sent.some(event => event.type === 'input_audio_buffer.append'));
    socket.send(JSON.stringify({ type: 'session.update', session: { instructions: 'untrusted replacement' } }));
    await once(socket, 'close');
    assert(!h.sent.some(event => JSON.stringify(event).includes('untrusted replacement')));
    await waitFor(() => h.released === 1);
  } finally { await h.close(); }
});

test('server revocation and hard deadline each close billed upstream and release the lease once', async () => {
  for (const mode of ['revoke', 'deadline'] as const) {
    const h = await harness('qwen', { remainingMs: mode === 'deadline' ? 100 : 60000 });
    try {
      const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
      if (mode === 'revoke') h.revoke();
      await once(socket, 'close'); await waitFor(() => h.released === 1);
      assert.notEqual(h.upstream?.readyState, WebSocket.OPEN);
    } finally { await h.close(); }
  }
});

test('GPT Live starts on its documented protocol and delegates verified work on the server', async () => {
  const h = await harness('openai');
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    assert.equal(h.sent[0].type, 'session.start');
    const session = h.sent[0].session as { audio: { format: unknown }; delegation: { type: string } };
    assert.deepEqual(session.audio.format, { type: 'audio/pcm', rate: 24000 }); assert.equal(session.delegation.type, 'client');
    socket.send(pcmFrame(true)); socket.send(pcmFrame(true));
    h.upstream!.send(JSON.stringify({ type: 'session.input_transcript.delta', delta: 'Circle the apple.' }));
    h.upstream!.send(JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'delegation_1', target: 'client' } }));
    finishSpokenInput(socket);
    await waitFor(() => h.tools.length === 1);
    assert.equal((h.tools[0] as { name: string }).name, 'delegate');
    assert.equal((h.tools[0] as { finalEvidence: { text: string; final: boolean }[] }).finalEvidence[0].text, 'Circle the apple.');
    assert.equal((h.tools[0] as { args: { contextKey: string } }).args.contextKey, `${id}:1:0`);
    await waitFor(() => h.sent.some(event => event.type === 'session.commentary.append' && event.delegation_id === 'delegation_1'));
    assert(h.sent.some(event => event.type === 'session.thinking.append' && event.content === '' && event.delegation_id === 'delegation_1'));
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close'); await waitFor(() => h.released === 1);
  } finally { await h.close(); }
});

test('provider errors stay generic, and startup timeout releases an unready connection', async () => {
  for (const mode of ['error', 'timeout'] as const) {
    const h = await harness('qwen', { autoReady: mode !== 'timeout', startupMs: 80 });
    try {
      const socket = h.connect(); await once(socket, 'open');
      if (mode === 'error') { await waitFor(() => h.downstream.some(event => event.type === 'ready')); h.upstream!.send(JSON.stringify({ type: 'error', error: { message: 'sensitive-upstream-error' } })); }
      await once(socket, 'close'); await waitFor(() => h.released === 1);
      assert(h.downstream.some(event => event.type === 'error'));
      assert(!JSON.stringify(h.downstream).includes('sensitive-upstream-error'));
    } finally { await h.close(); }
  }
});

test('heartbeat publishes a changed snapshot while preserving its server revision', async () => {
  const h = await harness();
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    h.advance(); await waitFor(() => h.downstream.some(event => event.type === 'snapshot' && (event.classroom as ClassroomSnapshot).revision === 2));
    assert(h.sent.some(event => event.type === 'session.update' && JSON.stringify(event).includes('say apple')));
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('a task refresh offers the next activity without ordering a conversational interruption',async()=>{
 const h=await harness('openai');
 try{
  const socket=h.connect();await once(socket,'open');await waitFor(()=>h.downstream.some(event=>event.type==='ready'));
  h.advance();await waitFor(()=>h.sent.some(event=>event.type==='session.commentary.append'&&String(event.content).includes('do not interrupt an ongoing conversation')));
  const cue=h.sent.find(event=>event.type==='session.commentary.append'&&String(event.content).includes('do not interrupt an ongoing conversation'));
  assert.match(String(cue?.content),/natural pause/);assert.match(String(cue?.content),/learner chooses to finish/);
  socket.send(JSON.stringify({type:'close'}));await once(socket,'close');
 }finally{await h.close();}
});

test('ending while a tool awaits cannot produce late confirmation or recreate speech', async () => {
  const h = await harness('openai', { delayedTool: true });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    socket.send(pcmFrame(true)); socket.send(pcmFrame(true));
    h.upstream!.send(JSON.stringify({ type: 'session.input_transcript.delta', delta: 'Apple.' }));
    h.upstream!.send(JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'late_tool', target: 'client' } }));
    finishSpokenInput(socket);
    await waitFor(() => h.tools.length === 1); h.revoke(); await once(socket, 'close');
    const before = h.sent.length; h.resolveTool(); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.sent.length, before); assert.equal(h.released, 1);
  } finally { await h.close(); }
});

test('server selected voice overrides the environment default at provider startup', async () => {
  const h = await harness('openai', { voice: 'meridian' });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'session.start'));
    assert.equal((h.sent[0].session as { audio: { output: { voice: string } } }).audio.output.voice, 'meridian');
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('HTTP feedback on the same task triggers one natural teaching cue, never repeated on unchanged heartbeat', async () => {
  const h = await harness('openai');
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    const before = h.sent.filter(event => event.type === 'session.commentary.append').length;
    h.feedback(); await waitFor(() => h.sent.filter(event => event.type === 'session.commentary.append').length > before);
    await new Promise(resolve => setTimeout(resolve, 65));
    assert.equal(h.sent.filter(event => event.type === 'session.commentary.append').length, before + 1);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('failure to persist provider session identity closes upstream before becoming ready', async () => {
  for (const provider of ['qwen', 'openai'] as const) {
    const h = await harness(provider, { startedFails: true });
    try {
      const socket = h.connect(); await once(socket, 'open'); await once(socket, 'close');
      assert.equal(h.persistedStarts, 0); assert(!h.downstream.some(event => event.type === 'ready')); await waitFor(() => h.released === 1);
    } finally { await h.close(); }
  }
});

test('GPT partial transcript and a delegation alone never become completed speech evidence', async () => {
  const h = await harness('openai');
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    socket.send(pcmFrame(true)); socket.send(pcmFrame(true));
    h.upstream!.send(JSON.stringify({ type: 'session.input_transcript.delta', delta: 'I like app' }));
    h.upstream!.send(JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'partial_1', target: 'client' } }));
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(h.tools.length, 0); assert(!h.transcripts.some(event => (event as { final?: boolean }).final));
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('GPT aggregates all fragments once after measured PCM silence, including a late transcript suffix', async () => {
  const h = await harness('openai');
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    socket.send(pcmFrame(true)); socket.send(pcmFrame(true));
    h.upstream!.send(JSON.stringify({ type: 'session.input_transcript.delta', delta: 'I like ' }));
    h.upstream!.send(JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'answer_1', target: 'client' } }));
    finishSpokenInput(socket);
    await new Promise(resolve => setTimeout(resolve, 5));
    h.upstream!.send(JSON.stringify({ type: 'session.input_transcript.delta', delta: 'apples.' }));
    await waitFor(() => h.tools.length === 1);
    const evidence = (h.tools[0] as { finalEvidence: { text: string; final: boolean; contextKey: string }[] }).finalEvidence;
    assert.equal(evidence.length, 1); assert.equal(evidence[0].text, 'I like apples.'); assert.equal(evidence[0].contextKey, `${id}:1:0`);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('changing task discards a pending GPT utterance and its delegation rather than grading it on the next task', async () => {
  const h = await harness('openai');
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    socket.send(pcmFrame(true)); socket.send(pcmFrame(true));
    h.upstream!.send(JSON.stringify({ type: 'session.input_transcript.delta', delta: 'Old answer' }));
    h.upstream!.send(JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'obsolete_1', target: 'client' } }));
    h.advance(); await waitFor(() => h.downstream.some(event => event.type === 'snapshot' && (event.classroom as ClassroomSnapshot).revision === 2));
    finishSpokenInput(socket); await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(h.tools.length, 0); assert(!h.transcripts.some(event => (event as { final?: boolean }).final));
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('authenticated typed input is persisted once before GPT delegation with the current task key', async () => {
  const h = await harness('openai');
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    socket.send(JSON.stringify({ type: 'text', text: 'I like apples.' })); await waitFor(() => h.tools.length === 1);
    const evidence = (h.tools[0] as { finalEvidence: { text: string; source: string; contextKey: string }[] }).finalEvidence;
    assert.equal(evidence.length, 1); assert.equal(evidence[0].source, 'typed'); assert.equal(evidence[0].text, 'I like apples.'); assert.equal(evidence[0].contextKey, `${id}:1:0`);
    assert.equal((h.tools[0] as { args: { contextKey: string } }).args.contextKey, `${id}:1:0`);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('Qwen completed ASR persists its captured task before the following native tool can grade', async () => {
  const h = await harness('qwen', { delayedTranscript: true });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    // A native tool belongs to a response after VAD, never to a still-cancelling greeting.
    h.upstream!.send(JSON.stringify({type:'response.done'}));
    h.upstream!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
    h.upstream!.send(JSON.stringify({type:'input_audio_buffer.speech_stopped'}));
    h.upstream!.send(JSON.stringify({type:'response.created'}));
    h.upstream!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Apple.', item_id: 'asr_1' }));
    h.upstream!.send(JSON.stringify({ type: 'response.function_call_arguments.done', name: 'submit_spoken_answer', call_id: 'tool_1', arguments: JSON.stringify({ contextKey: `${id}:1:0`, answer: 'Apple.' }) }));
    await waitFor(()=>h.transcriptWaiting);assert.equal(h.tools.length, 0);
    h.resolveTranscript(); await waitFor(() => h.tools.length === 1);
    const evidence = (h.tools[0] as { finalEvidence: { text: string; contextKey: string; source: string }[] }).finalEvidence;
    assert.equal(evidence[0].contextKey, `${id}:1:0`); assert.equal(evidence[0].source, 'speech'); assert.equal(evidence[0].text, 'Apple.');
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('Qwen cancellation waits for response.done before creating a replacement reply', async () => {
  const h = await harness('qwen', { delayedResponses: true });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'response.create'));
    h.upstream!.send(JSON.stringify({ type: 'response.created' })); h.feedback('replacement cue');
    await waitFor(() => h.sent.some(event => event.type === 'response.cancel'));
    h.upstream!.send(JSON.stringify({ type: 'response.audio.delta', delta: 'AAAAAA==' }));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
    assert.equal(h.downstream.filter(event => event.type === 'audio').length, 0);
    assert(h.downstream.some(event => event.type === 'interrupt'));
    h.upstream!.send(JSON.stringify({ type: 'response.done' }));
    await waitFor(() => h.sent.filter(event => event.type === 'response.create').length === 2);
    assert.equal(socket.readyState, WebSocket.OPEN);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('a cancelled Qwen reply with truncated tool arguments cannot close the voice connection', async () => {
  const h = await harness('qwen', { delayedResponses: true, heartbeatMs: 60000 });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'response.create'));
    h.upstream!.send(JSON.stringify({ type: 'response.created' }));
    h.feedback('A newer application cue'); await refreshClassroom(id);
    await waitFor(() => h.sent.some(event => event.type === 'response.cancel'));
    h.upstream!.send(JSON.stringify({ type: 'response.function_call_arguments.done', name: 'highlight_objects', call_id: 'cancelled_partial', arguments: '{"objectIds":[' }));
    h.upstream!.send(JSON.stringify({ type: 'response.done' }));
    await waitFor(() => h.sent.filter(event => event.type === 'response.create').length === 2 || h.downstream.some(event => event.type === 'error'));
    assert.equal(h.downstream.filter(event => event.type === 'error').length, 0); assert.equal(socket.readyState, WebSocket.OPEN); assert.equal(h.tools.length, 0);
    assert(!h.sent.some(event => JSON.stringify(event).includes('cancelled_partial')));
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('invalid current Qwen tool arguments return one unavailable result without application execution or media failure', async () => {
  const h = await harness('qwen', { delayedResponses: true, heartbeatMs: 60000 });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'response.create'));
    h.upstream!.send(JSON.stringify({ type: 'response.created' }));
    const invalid = JSON.stringify({ type: 'response.function_call_arguments.done', name: 'highlight_objects', call_id: 'invalid_current', arguments: '{"objectIds":[' });
    h.upstream!.send(invalid); h.upstream!.send(invalid); h.upstream!.send(JSON.stringify({ type: 'response.done' }));
    await waitFor(() => h.sent.some(event => event.type === 'conversation.item.create' && (event.item as {call_id?:string})?.call_id === 'invalid_current') || h.downstream.some(event => event.type === 'error'));
    assert.equal(h.downstream.filter(event => event.type === 'error').length, 0); assert.equal(socket.readyState, WebSocket.OPEN); assert.equal(h.tools.length, 0);
    const results=h.sent.filter(event=>event.type==='conversation.item.create'&&(event.item as {call_id?:string})?.call_id==='invalid_current');
    assert.equal(results.length,1);assert.equal(JSON.parse((results[0].item as {output:string}).output).status,'unavailable');
    await waitFor(()=>h.sent.filter(event=>event.type==='response.create').length===2);
    h.upstream!.send(JSON.stringify({type:'response.created'}));
    h.upstream!.send(JSON.stringify({type:'response.function_call_arguments.done',name:'highlight_objects',call_id:'invalid_retry',arguments:'null'}));
    h.upstream!.send(JSON.stringify({type:'response.done'}));
    await waitFor(()=>h.sent.some(event=>event.type==='conversation.item.create'&&(event.item as {call_id?:string})?.call_id==='invalid_retry'));
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(h.tools.length,0);assert.equal(h.sent.filter(event=>event.type==='response.create').length,2,'invalid tool recovery cannot loop another response');
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('late Qwen tool arguments from the previous objective are discarded while the next response is pending', async () => {
  const h = await harness('qwen', { delayedResponses: true, heartbeatMs: 60000 });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'response.create'));
    h.upstream!.send(JSON.stringify({ type: 'response.created' })); h.upstream!.send(JSON.stringify({ type: 'response.done' }));
    await new Promise(resolve=>setTimeout(resolve,5)); h.advance(); await refreshClassroom(id);
    await waitFor(() => h.sent.filter(event=>event.type==='response.create').length===2);
    h.upstream!.send(JSON.stringify({ type: 'response.function_call_arguments.done', name: 'highlight_objects', call_id: 'obsolete_partial', arguments: '{"objectIds":[' }));
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(h.downstream.filter(event=>event.type==='error').length,0);assert.equal(h.tools.length,0);
    assert(!h.sent.some(event=>JSON.stringify(event).includes('obsolete_partial')));
    h.upstream!.send(JSON.stringify({type:'response.created'}));
    h.upstream!.send(JSON.stringify({type:'response.function_call_arguments.done',name:'highlight_objects',call_id:'obsolete_valid_json',arguments:JSON.stringify({contextKey:`${id}:1:0`,objectIds:['apple']})}));
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(h.tools.length,0);
    assert(!h.sent.some(event=>JSON.stringify(event).includes('obsolete_valid_json')));
    socket.send(JSON.stringify({type:'close'}));await once(socket,'close');
  } finally {await h.close();}
});

test('Qwen create-to-created window holds new cues and keeps only the latest pending replacement', async () => {
  const h = await harness('qwen', { delayedResponses: true });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'response.create'));
    h.feedback('first pending cue'); await waitFor(() => h.sent.some(event => event.type === 'session.update' && JSON.stringify(event).includes('first pending cue')));
    h.feedback('latest pending cue'); await waitFor(() => h.sent.some(event => event.type === 'session.update' && JSON.stringify(event).includes('latest pending cue')));
    assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
    h.upstream!.send(JSON.stringify({ type: 'response.created' }));
    await waitFor(() => h.sent.some(event => event.type === 'response.cancel'));
    h.upstream!.send(JSON.stringify({ type: 'response.done' })); await waitFor(() => h.sent.filter(event => event.type === 'response.create').length === 2);
    const response = h.sent.filter(event => event.type === 'response.create')[1];
    assert(JSON.stringify(response).includes('latest pending cue')); assert(!JSON.stringify(response).includes('first pending cue'));
    assert.equal(h.downstream.filter(event => event.type === 'error').length, 0);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('Qwen missing response.created acknowledgement times out visibly and releases the billed connection', async () => {
  const h = await harness('qwen', { delayedResponses: true, responseAckMs: 60 });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'response.create'));
    await waitFor(() => h.released === 1);
    await waitFor(() => h.downstream.some(event => event.type === 'error') && h.upstream!.readyState !== WebSocket.OPEN);
    assert.equal(h.downstream.find(event => event.type === 'error')?.code, 'response_timeout');
  } finally { await h.close(); }
});

test('connection failures carry safe layer codes instead of resembling an intentional close', async () => {
  for (const cause of ['provider_error', 'input_rate_limited', 'upstream_closed', 'lease_lost'] as const) {
    const h = await harness('qwen', { heartbeatMs: 20 });
    try {
      const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
      if (cause === 'provider_error') h.upstream!.send(JSON.stringify({ type: 'error', error: { message: 'PRIVATE_UPSTREAM_DETAIL' } }));
      else if (cause === 'input_rate_limited') for (let i = 0; i < 17; i++) socket.send(JSON.stringify({ type: 'audio', audio: Buffer.alloc(3200).toString('base64') }));
      else if (cause === 'upstream_closed') h.upstream!.terminate();
      else h.revoke();
      await once(socket, 'close'); await waitFor(() => h.released === 1);
      assert.equal(h.downstream.find(event => event.type === 'error')?.code, cause);
      assert(!JSON.stringify(h.downstream).includes('PRIVATE_UPSTREAM_DETAIL'));
      assert(!h.downstream.some(event => event.type === 'snapshot' && (event.classroom as ClassroomSnapshot).status === 'paused'));
    } finally { await h.close(); }
  }
});

test('normal 100ms PCM captured in bounded 450ms browser batches survives sixty seconds across receive windows', {timeout:5000}, async t => {
  const h=await harness('qwen',{heartbeatMs:60000});
  try {
    const socket=h.connect();await once(socket,'open');await waitFor(()=>h.downstream.some(event=>event.type==='ready'));
    const base=Date.now();let clock=base,capturedAt=100,frames=0;
    t.mock.method(Date,'now',()=>clock);
    for(const arrival of [...Array.from({length:133},(_,i)=>(i+1)*450),60000]){
      clock=base+arrival;
      while(capturedAt<=arrival){assert(arrival-capturedAt<=450);socket.send(JSON.stringify({type:'audio',audio:Buffer.alloc(3200).toString('base64')}));capturedAt+=100;frames++;}
      const until=performance.now()+1000;
      while(h.sent.filter(event=>event.type==='input_audio_buffer.append').length<frames&&!h.downstream.some(event=>event.type==='error')){if(performance.now()>until)throw Error('Bounded PCM batch was not forwarded');await new Promise(resolve=>setTimeout(resolve,2));}
      assert.equal(h.downstream.filter(event=>event.type==='error').length,0);
    }
    assert.equal(frames,600);assert.equal(socket.readyState,WebSocket.OPEN);
    t.mock.restoreAll();socket.send(JSON.stringify({type:'close'}));await once(socket,'close');
  }finally{t.mock.restoreAll();await h.close();}
});

test('GPT context appends contain only compact facts and every append stays within a conservative UTF8 bound', async () => {
  const h = await harness('openai', { instructions: 'STATIC_RULE_DO_NOT_RESEND '.repeat(200), spokenResult: '这是一个较长的确认。'.repeat(100) });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    h.feedback('这是已确认的课堂反馈。'.repeat(100));
    await waitFor(() => h.downstream.some(event => event.type === 'snapshot' && (event.classroom as ClassroomSnapshot).revision === 2));
    socket.send(JSON.stringify({ type: 'text', text: 'Apple.' })); await waitFor(() => h.tools.length === 1);
    await waitFor(() => h.sent.some(event => event.type === 'session.commentary.append' && String(event.content).includes('较长')));
    const appends = h.sent.filter(event => String(event.type).endsWith('.append'));
    for (const event of appends) assert(Buffer.byteLength(String(event.content), 'utf8') <= 480);
    const content = appends.map(event => String(event.content)).join('');
    assert(!content.includes('STATIC_RULE_DO_NOT_RESEND')); assert(content.includes(`${id}:1:0`));
    assert(content.includes('Find the apple.'));
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('GPT task-change commentary contains the actual current question before quiet context acknowledgements', async () => {
  const h = await harness('openai');
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    h.advance(); await waitFor(() => h.sent.some(event => event.type === 'session.commentary.append' && String(event.content).includes('Say the banana.')));
    assert.equal(h.downstream.filter(event => event.type === 'error').length, 0);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('HTTP refresh synchronizes owner task before the next received learner input without waiting for polling', async () => {
  const h = await harness('openai', { heartbeatMs: 60000 });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    h.advance(); await refreshClassroom(id);
    socket.send(JSON.stringify({ type: 'text', text: 'Banana.' })); await waitFor(() => h.transcripts.length === 1);
    assert.equal((h.transcripts[0] as { contextKey: string }).contextKey, `${id}:1:1`);
    await waitFor(() => h.downstream.some(event => event.type === 'snapshot' && (event.classroom as ClassroomSnapshot).stepIndex === 1));
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('a refresh requested during an in-flight heartbeat is drained before both callers resolve and stop unsubscribes', async () => {
  const h = await harness('openai', { heartbeatMs: 60000 });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    h.delayNextHeartbeat(); const first = refreshClassroom(id); await waitFor(() => h.heartbeatCalls === 1);
    h.advance(); const second = refreshClassroom(id); h.releaseHeartbeat(); await Promise.all([first, second]);
    assert.equal(h.heartbeatCalls, 2);
    await waitFor(() => h.downstream.some(event => event.type === 'snapshot' && (event.classroom as ClassroomSnapshot).revision === 2));
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close'); await waitFor(() => h.released === 1);
    const before = h.heartbeatCalls; await refreshClassroom(id); assert.equal(h.heartbeatCalls, before);
  } finally { await h.close(); }
});

test('a transcript handler may await authoritative refresh without cycling on its own transcript chain', async () => {
  const h = await harness('openai', { heartbeatMs: 60000, refreshOnTranscript: true });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    socket.send(JSON.stringify({ type: 'text', text: 'Apple.' }));
    await waitFor(() => h.downstream.some(event => event.type === 'snapshot' && (event.classroom as ClassroomSnapshot).stepIndex === 1));
    assert.equal(h.transcripts.length, 1); assert.equal(h.tools.length, 0);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close'); await waitFor(() => h.released === 1);
  } finally { await h.close(); }
});

test('Qwen VAD end reserves the automatic response before final ASR refresh can request a new question', async () => {
  const h = await harness('qwen', { delayedResponses: true, heartbeatMs: 60000, refreshOnTranscript: true });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'response.create'));
    h.upstream!.send(JSON.stringify({ type: 'response.created' })); h.upstream!.send(JSON.stringify({ type: 'response.done' }));
    h.upstream!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
    h.upstream!.send(JSON.stringify({ type: 'input_audio_buffer.speech_stopped' }));
    h.upstream!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Apple.', item_id: 'voice_reply_1' }));
    await waitFor(() => h.downstream.some(event => event.type === 'snapshot' && (event.classroom as ClassroomSnapshot).stepIndex === 1));
    assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
    h.upstream!.send(JSON.stringify({ type: 'response.created' })); await waitFor(() => h.sent.some(event => event.type === 'response.cancel'));
    assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
    h.upstream!.send(JSON.stringify({ type: 'response.done' })); await waitFor(() => h.sent.filter(event => event.type === 'response.create').length === 2);
    h.upstream!.send(JSON.stringify({ type: 'response.created' }));
    h.upstream!.send(JSON.stringify({ type: 'response.audio.delta', delta: 'AAAAAA==' })); await waitFor(() => h.downstream.some(event => event.type === 'audio'));
    assert.equal(h.downstream.filter(event => event.type === 'error').length, 0);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('Qwen VAD pending survives the old response cancellation acknowledgement', async () => {
  const h = await harness('qwen', { delayedResponses: true, heartbeatMs: 60000 });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'response.create'));
    h.upstream!.send(JSON.stringify({ type: 'response.created' })); h.upstream!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
    await waitFor(() => h.sent.filter(event => event.type === 'response.cancel').length === 1);
    h.upstream!.send(JSON.stringify({ type: 'input_audio_buffer.speech_stopped' })); h.feedback('new task after native VAD'); await refreshClassroom(id);
    h.upstream!.send(JSON.stringify({ type: 'response.done' })); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
    h.upstream!.send(JSON.stringify({ type: 'response.created' })); await waitFor(() => h.sent.filter(event => event.type === 'response.cancel').length === 2);
    h.upstream!.send(JSON.stringify({ type: 'response.done' })); await waitFor(() => h.sent.filter(event => event.type === 'response.create').length === 2);
    assert.equal(h.downstream.filter(event => event.type === 'error').length, 0);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('Qwen automatic VAD response missing its created acknowledgement also has a bounded timeout', async () => {
  const h = await harness('qwen', { delayedResponses: true, heartbeatMs: 60000, responseAckMs: 60 });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'response.create'));
    h.upstream!.send(JSON.stringify({ type: 'response.created' })); h.upstream!.send(JSON.stringify({ type: 'response.done' }));
    h.upstream!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' })); h.upstream!.send(JSON.stringify({ type: 'input_audio_buffer.speech_stopped' }));
    await waitFor(() => h.released === 1 && h.downstream.some(event => event.type === 'error'));
    assert.notEqual(h.upstream!.readyState, WebSocket.OPEN);
  } finally { await h.close(); }
});

function outputClock() {
  let time = 0, nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: PcmOutputClock = { now: () => time, schedule: (callback, milliseconds) => { const id = ++nextId; timers.set(id, { at: time + milliseconds, callback }); return id; }, cancel: handle => { timers.delete(handle as number); } };
  return { clock, timers, advance(milliseconds: number) {
    const end = time + milliseconds;
    for (;;) { const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!next || next[1].at > end) break; timers.delete(next[0]); time = Math.max(time, next[1].at); next[1].callback(); }
    time = end;
  } };
}

test('both providers pace burst audio to the consumer clock rather than forwarding seconds immediately', async () => {
  for (const provider of ['qwen', 'openai'] as const) {
    const output = outputClock(), h = await harness(provider, { delayedResponses: true, heartbeatMs: 60000, audioClock: output.clock });
    try {
      const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
      if (provider === 'qwen') { await waitFor(() => h.sent.some(event => event.type === 'response.create')); h.upstream!.send(JSON.stringify({ type: 'response.created' })); }
      const type = provider === 'qwen' ? 'response.audio.delta' : 'session.output_audio.delta', audio = Buffer.alloc(144000).toString('base64');
      h.upstream!.send(JSON.stringify({ type, delta: audio })); h.upstream!.send(JSON.stringify({ type, delta: audio }));
      await waitFor(() => output.timers.size === 1); assert.equal(h.downstream.filter(event => event.type === 'audio').length, 0);
      output.advance(1000); await waitFor(() => h.downstream.filter(event => event.type === 'audio').length >= 21);
      const frames = h.downstream.filter(event => event.type === 'audio'); assert.equal(frames.length, 21);
      assert(frames.every(event => Buffer.from(String(event.audio), 'base64').length <= 2400));
      socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
      output.advance(10000); assert.equal(output.timers.size, 0);
    } finally { await h.close(); }
  }
});

test('a new task clears already-generated Qwen audio even after response.done and drops pending stale packets', async () => {
  const output = outputClock(), h = await harness('qwen', { delayedResponses: true, heartbeatMs: 60000, audioClock: output.clock });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'response.create'));
    h.upstream!.send(JSON.stringify({ type: 'response.created' }));
    h.upstream!.send(JSON.stringify({ type: 'response.audio.delta', delta: Buffer.alloc(144000, 0x11).toString('base64') })); h.upstream!.send(JSON.stringify({ type: 'response.done' }));
    await waitFor(() => output.timers.size === 1); output.advance(0); await waitFor(() => h.downstream.some(event => event.type === 'audio'));
    const before = h.downstream.filter(event => event.type === 'audio').length;
    h.advance(); await refreshClassroom(id); await waitFor(() => h.sent.filter(event => event.type === 'response.create').length === 2);
    h.upstream!.send(JSON.stringify({ type: 'response.audio.delta', delta: Buffer.alloc(2400, 0x33).toString('base64') }));
    await new Promise(resolve => setTimeout(resolve, 5)); output.advance(7000); await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(h.downstream.filter(event => event.type === 'audio').length, before);
    assert(h.downstream.some(event => event.type === 'interrupt'));
    h.upstream!.send(JSON.stringify({ type: 'response.created' }));
    h.upstream!.send(JSON.stringify({ type: 'response.audio.delta', delta: Buffer.alloc(2400, 0x22).toString('base64') }));
    await waitFor(() => output.timers.size === 1); output.advance(0); await waitFor(() => h.downstream.filter(event => event.type === 'audio').length === before + 1);
    assert.equal(Buffer.from(String(h.downstream.filter(event => event.type === 'audio').at(-1)!.audio), 'base64')[0], 0x22);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('Qwen same-task tool feedback refresh preserves every queued PCM byte across response boundaries', async () => {
  const output = outputClock(), h = await harness('qwen', { delayedResponses: true, heartbeatMs: 60000, audioClock: output.clock, refreshOnTool: true });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.sent.some(event => event.type === 'response.create'));
    h.upstream!.send(JSON.stringify({ type: 'response.created' }));
    h.upstream!.send(JSON.stringify({ type: 'response.audio.delta', delta: Buffer.alloc(144000, 0x11).toString('base64') }));
    h.upstream!.send(JSON.stringify({ type: 'response.function_call_arguments.done', name: 'highlight_objects', call_id: 'continuation', arguments: JSON.stringify({ contextKey: `${id}:1:0`, objectIds: ['apple'] }) }));
    h.upstream!.send(JSON.stringify({ type: 'response.done' }));
    await waitFor(() => h.sent.filter(event => event.type === 'response.create').length === 2);
    assert(h.downstream.some(event => event.type === 'snapshot' && (event.classroom as ClassroomSnapshot).feedback?.id === 'tool-feedback'));
    assert(!h.sent.some(event => event.type === 'response.cancel'));
    h.upstream!.send(JSON.stringify({ type: 'response.created' }));
    h.upstream!.send(JSON.stringify({ type: 'response.audio.delta', delta: Buffer.alloc(4800, 0x22).toString('base64') }));
    h.upstream!.send(JSON.stringify({ type: 'response.done' }));
    await new Promise(resolve => setTimeout(resolve, 10)); output.advance(4000);
    await waitFor(() => h.downstream.filter(event => event.type === 'audio').length >= 2);
    const bytes = Buffer.concat(h.downstream.filter(event => event.type === 'audio').map(event => Buffer.from(String(event.audio), 'base64')));
    assert.equal(bytes.length, 148800); assert(bytes.subarray(0, 144000).every(value => value === 0x11)); assert(bytes.subarray(144000).every(value => value === 0x22));
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('GPT learner speech immediately clears playback and cannot replay late old audio during speech or missing PCM', async () => {
  const output = outputClock(), h = await harness('openai', { heartbeatMs: 60000, audioClock: output.clock });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    h.upstream!.send(JSON.stringify({ type: 'session.output_audio.delta', delta: Buffer.alloc(144000, 0x11).toString('base64') }));
    await waitFor(() => output.timers.size === 1); output.advance(0); await waitFor(() => h.downstream.some(event => event.type === 'audio'));
    const before = h.downstream.filter(event => event.type === 'audio').length, interrupts = h.downstream.filter(event => event.type === 'interrupt').length;
    socket.send(pcmFrame(true));
    await waitFor(() => h.sent.some(event => event.type === 'session.input_audio.append'));
    h.upstream!.send(JSON.stringify({ type: 'session.output_audio.delta', delta: Buffer.alloc(2400, 0x33).toString('base64') }));
    await new Promise(resolve => setTimeout(resolve, 20)); output.advance(7000); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(h.downstream.filter(event => event.type === 'audio').length, before);
    assert(h.downstream.filter(event => event.type === 'interrupt').length > interrupts);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close'); assert.equal(output.timers.size, 0);
  } finally { await h.close(); }
});

test('GPT task gate uses actual output silence despite continuous media frames and drops uncertain new speech', async () => {
  const output = outputClock(), h = await harness('openai', { heartbeatMs: 60000, audioClock: output.clock, gptOutputQuietMs: 80, contextVersion: 'version'.repeat(100) });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    h.upstream!.send(JSON.stringify({ type: 'session.output_audio.delta', delta: Buffer.alloc(144000, 0x11).toString('base64') }));
    await waitFor(() => output.timers.size === 1);
    h.advance(); await refreshClassroom(id); await waitFor(() => h.sent.filter(event => event.type === 'session.commentary.append').length === 2);
    const contexts = h.sent.filter(event => event.type === 'session.thinking.append'), context = contexts.at(-1)!; assert(contexts.length > 1);
    h.upstream!.send(JSON.stringify({ type: 'session.thinking.appended', client_event_id: contexts[0].event_id }));
    finishSpokenInput(socket); await waitFor(() => h.sent.filter(event => event.type === 'session.input_audio.append').length === 12);
    await new Promise(resolve => setTimeout(resolve, 90)); assert.equal(output.timers.size, 0);
    h.upstream!.send(JSON.stringify({ type: 'session.thinking.appended', client_event_id: context.event_id }));
    h.upstream!.send(JSON.stringify({ type: 'session.output_audio.delta', delta: Buffer.alloc(2400, 0x33).toString('base64') }));
    const quietFrame = JSON.stringify({ type: 'session.output_audio.delta', delta: Buffer.alloc(480).toString('base64') });
    for (let i = 0; i < 7; i++) h.upstream!.send(quietFrame);
    h.upstream!.send(JSON.stringify({ type: 'session.output_audio.delta', delta: Buffer.alloc(2400, 0x44).toString('base64') }));
    for (let i = 0; i < 7; i++) h.upstream!.send(quietFrame);
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(output.timers.size, 0);
    assert.equal(h.sent.filter(event => event.type === 'session.commentary.append').length, 2);
    h.upstream!.send(quietFrame);
    await waitFor(() => h.sent.filter(event => event.type === 'session.commentary.append').length === 3);
    assert(String(h.sent.filter(event => event.type === 'session.commentary.append').at(-1)!.content).includes('Say the banana.'));
    h.upstream!.send(JSON.stringify({ type: 'session.output_audio.delta', delta: Buffer.alloc(2400, 0x22).toString('base64') }));
    await waitFor(() => output.timers.size === 1); output.advance(0); await waitFor(() => h.downstream.some(event => event.type === 'audio'));
    const frames = h.downstream.filter(event => event.type === 'audio'); assert.equal(frames.length, 1);
    assert(Buffer.from(String(frames[0].audio), 'base64').every(value => value === 0x22));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(h.sent.filter(event => event.type === 'session.commentary.append').length, 3);
    assert.equal(h.sent.filter(event => event.type === 'session.start').length, 1);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally { await h.close(); }
});

test('GPT output gate has a bounded wait and closing it releases every queued frame', async () => {
  const output = outputClock(), h = await harness('openai', { heartbeatMs: 60000, audioClock: output.clock, gptOutputWaitMs: 60 });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    socket.send(pcmFrame(true)); await once(socket, 'close'); await waitFor(() => h.released === 1);
    output.advance(60000); assert.equal(output.timers.size, 0);
    assert(h.downstream.some(event => event.type === 'error')); assert.notEqual(h.upstream?.readyState, WebSocket.OPEN);
  } finally { await h.close(); }
});

test('closing GPT during the recovery quiet window never appends a late recovery cue or opens another session', async () => {
  const h = await harness('openai', { heartbeatMs: 60000, gptOutputQuietMs: 80 });
  try {
    const socket = h.connect(); await once(socket, 'open'); await waitFor(() => h.downstream.some(event => event.type === 'ready'));
    h.advance(); await refreshClassroom(id); await waitFor(() => h.sent.filter(event => event.type === 'session.commentary.append').length === 2);
    h.upstream!.send(JSON.stringify({ type: 'session.thinking.appended', client_event_id: h.sent.filter(event => event.type === 'session.thinking.append').at(-1)!.event_id }));
    finishSpokenInput(socket); await waitFor(() => h.sent.filter(event => event.type === 'session.input_audio.append').length === 12);
    for (let i = 0; i < 7; i++) h.upstream!.send(JSON.stringify({ type: 'session.output_audio.delta', delta: Buffer.alloc(480).toString('base64') }));
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(h.sent.filter(event => event.type === 'session.commentary.append').length, 2);
    assert.equal(h.sent.filter(event => event.type === 'session.start').length, 1); assert.equal(h.opened, 1); assert.equal(h.released, 1);
  } finally { await h.close(); }
});


const visionJpeg=Buffer.from([255,216,255,192,0,11,8,0,240,1,64,1,1,17,0,255,217]).toString('base64');
test('authenticated Qwen camera frames use native image append and invalid images keep voice connected',async()=>{
 const h=await harness();try{
  const socket=h.connect();await once(socket,'open');await waitFor(()=>h.downstream.some(event=>event.type==='ready'));
  socket.send(JSON.stringify({type:'vision.start',generation:1}));
  socket.send(JSON.stringify({type:'audio',audio:Buffer.alloc(3200).toString('base64')}));await waitFor(()=>h.sent.some(event=>event.type==='input_audio_buffer.append'));
  socket.send(JSON.stringify({type:'vision.frame',generation:1,sequence:1,image:visionJpeg}));
  await waitFor(()=>h.sent.some(event=>event.type==='input_image_buffer.append'));
  assert.equal(h.sent.find(event=>event.type==='input_image_buffer.append')?.image,visionJpeg);
  socket.send(JSON.stringify({type:'vision.frame',generation:1,sequence:2,image:'bad JPEG'}));
  await waitFor(()=>h.downstream.some(event=>event.type==='vision.state'&&event.status==='error'));
  assert.equal(h.released,0);assert.equal(socket.readyState,WebSocket.OPEN);assert(!h.downstream.some(event=>event.type==='error'));
 }finally{await h.close();}
});
test('GPT camera frames go through its observer and only textual observations enter Live',async()=>{
 let called=0;const h=await harness('openai',{observe:async input=>{called++;assert.equal(input.image,visionJpeg);return{visible:true,description:'A blue toy car is visible.'};}});
 try{
  const socket=h.connect();await once(socket,'open');await waitFor(()=>h.downstream.some(event=>event.type==='ready'));
  socket.send(JSON.stringify({type:'vision.start',generation:1}));socket.send(JSON.stringify({type:'vision.frame',generation:1,sequence:1,image:visionJpeg}));
  await waitFor(()=>h.sent.some(event=>event.type==='session.thinking.append'&&String(event.content).includes('A blue toy car')));
  assert.equal(called,1);assert(!h.sent.some(event=>event.type==='input_image_buffer.append'||JSON.stringify(event).includes(visionJpeg)));
  socket.send(JSON.stringify({type:'vision.stop',generation:1}));await waitFor(()=>h.downstream.some(event=>event.type==='vision.state'&&event.status==='off'));assert.equal(h.released,0);
 }finally{await h.close();}
});

test('vision control messages retain the small non-image message limit',async()=>{
 const h=await harness();try{const socket=h.connect();await once(socket,'open');await waitFor(()=>h.downstream.some(event=>event.type==='ready'));socket.send(JSON.stringify({type:'vision.start',generation:1,padding:'x'.repeat(40000)}));await waitFor(()=>h.downstream.some(event=>event.type==='error'));assert.equal(h.downstream.find(event=>event.type==='error')?.code,'protocol_error');}finally{await h.close();}
});

test('a recoverable provider image-parameter error stops only vision; unrelated errors still stop voice',async()=>{
 const h=await harness();try{
  const socket=h.connect();await once(socket,'open');await waitFor(()=>h.downstream.some(event=>event.type==='ready'));
  socket.send(JSON.stringify({type:'vision.start',generation:1}));socket.send(JSON.stringify({type:'audio',audio:Buffer.alloc(3200).toString('base64')}));await waitFor(()=>h.sent.some(event=>event.type==='input_audio_buffer.append'));
  socket.send(JSON.stringify({type:'vision.frame',generation:1,sequence:1,image:visionJpeg}));await waitFor(()=>h.sent.some(event=>event.type==='input_image_buffer.append'));
  h.upstream!.send(JSON.stringify({type:'error',error:{type:'invalid_request_error',param:'image',code:'invalid_value',message:'private provider text must not be forwarded'}}));
  await waitFor(()=>h.downstream.some(event=>event.type==='vision.state'&&event.status==='error'));assert.equal(h.released,0);assert.equal(socket.readyState,WebSocket.OPEN);assert(!JSON.stringify(h.downstream).includes('private provider text'));
  h.upstream!.send(JSON.stringify({type:'error',error:{type:'invalid_request_error',param:'session.modalities',code:'invalid_value'}}));await waitFor(()=>h.released===1);assert(h.downstream.some(event=>event.type==='error'&&event.code==='provider_error'));
 }finally{await h.close();}
});
