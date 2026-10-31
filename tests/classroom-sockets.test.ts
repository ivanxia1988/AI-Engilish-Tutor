import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { attachClassroomSockets, type VoiceLease } from '../lib/server/classroom-sockets';
import type { ClassroomSnapshot } from '../lib/classroom-contract';
import { refreshClassroom } from '../lib/server/classroom-events';

const id = '6e98bb60-4ed0-4c64-bcbc-174d5dcb26c2';
const snapshot = { id, revision: 1, stepIndex: 0, connectionEpoch: 1, status: 'active', preferences: { voice: 'female' }, teacherObjectIds: [], feedback: null,
  course: { id: 'picnic', version: '1', title: 'Picnic', pages: [{ id: 'page-1', objects: [{ id: 'apple', label: 'apple', chinese: '苹果' }] }], steps: [{ id: 'find-apple', kind: 'select', pageId: 'page-1', english: 'Find the apple.' }, { id: 'say-banana', kind: 'speak', pageId: 'page-1', english: 'Say the banana.' }] },
} as unknown as ClassroomSnapshot;
const waitFor = async (condition: () => boolean) => {
  const end = Date.now() + 2000;
  while (!condition()) { if (Date.now() >= end) throw new Error('Expected socket event did not arrive.'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
async function harness(provider: 'qwen' | 'openai' = 'qwen', extra: { remainingMs?: number; startupMs?: number; autoReady?: boolean; delayedTool?: boolean; voice?: string; startedFails?: boolean; delayedTranscript?: boolean; delayedResponses?: boolean; responseAckMs?: number; instructions?: string; spokenResult?: string; heartbeatMs?: number; refreshOnTranscript?: boolean } = {}) {
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
    id, epoch: 1, provider, instructions: 'Current verified task: find apple.', initialCue: 'Can you find the apple?', remainingMs: extra.remainingMs ?? 60000, snapshot, ...(extra.voice ? { voice: extra.voice } : {}),
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
    async tool(name, args) { tools.push({ name, args, finalEvidence: transcripts.filter(event => (event as { final?: boolean }).final) }); if (extra.delayedTool) await new Promise<void>(resolve => { resolveTool = resolve; }); return { output: { status: 'confirmed', english: extra.spokenResult ?? 'The application confirms the selected apple.' }, snapshot: current }; },
    async closed() { released++; },
  };
  const controller = attachClassroomSockets(app, {
    origin: 'http://localhost:8080',
    open: async () => { opened++; return lease; },
    config: () => ({ key: 'non-production-fixture', model: provider === 'qwen' ? 'qwen3.8-omni-flash-realtime' : 'gpt-live-1', voice: 'Tina', workspaceId: 'workspace', region: 'cn-beijing', childDataReady: true }),
    connect: () => new WebSocket(`ws://127.0.0.1:${vendorAddress.port}`),
    heartbeatMs: extra.heartbeatMs ?? 25, startupMs: extra.startupMs ?? 1000, closeMs: 30, utteranceSettleMs: 20, responseAckMs: extra.responseAckMs ?? 1000,
  });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const address = app.address(); assert(address && typeof address !== 'string');
  const connect = (origin = 'http://localhost:8080', cookie = `teeko_session=${'t'.repeat(43)}`) => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/classrooms/${id}`, { headers: { Origin: origin, Cookie: cookie } });
    socket.on('error', () => {});
    socket.on('message', data => downstream.push(JSON.parse(data.toString())));
    return socket;
  };
  return { connect, sent, downstream, transcripts, tools, get opened() { return opened; }, get released() { return released; }, get persistedStarts() { return persistedStarts; }, get upstream() { return upstream; }, get heartbeatCalls() { return heartbeatCalls; }, delayNextHeartbeat: () => { delayHeartbeat = true; }, releaseHeartbeat: () => releaseHeartbeat?.(), revoke: () => { heartbeatAllowed = false; }, resolveTool: () => resolveTool?.(), resolveTranscript: () => resolveTranscript?.(), advance: () => { current = { ...snapshot, revision: 2, stepIndex: 1 }; }, feedback: (message = 'Try once more.') => { current = { ...current, revision: current.revision + 1, feedback: { id: `feedback_${current.revision + 1}`, kind: 'retry', message } }; }, async close() { await controller.close(); for (const socket of vendor.clients) socket.terminate(); await new Promise<void>(resolve => vendor.close(() => resolve())); await new Promise<void>(resolve => upstreamHttp.close(() => resolve())); await new Promise<void>(resolve => app.close(() => resolve())); } };
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
    h.upstream!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
    h.upstream!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Apple.', item_id: 'asr_1' }));
    h.upstream!.send(JSON.stringify({ type: 'response.function_call_arguments.done', name: 'submit_spoken_answer', call_id: 'tool_1', arguments: JSON.stringify({ contextKey: `${id}:1:0`, answer: 'Apple.' }) }));
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(h.tools.length, 0);
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
    h.upstream!.send(JSON.stringify({ type: 'response.audio.delta', delta: 'AAAA' }));
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
  } finally { await h.close(); }
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
    h.upstream!.send(JSON.stringify({ type: 'response.audio.delta', delta: 'AAAA' })); await waitFor(() => h.downstream.some(event => event.type === 'audio'));
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
