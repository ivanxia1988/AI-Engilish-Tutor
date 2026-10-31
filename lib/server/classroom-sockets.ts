import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import type { ClassroomSnapshot } from '../classroom-contract';
import { createQwenProtocol, qwenEndpoint, type QwenRegion } from '../voice-providers/qwen';
import type { VoiceCommand } from '../voice-providers/types';
import { CLASSROOM_VOICE_TOOLS } from '../voice-instructions';
import { contextChunks, spokenUpdate } from '../live-agent';
import { readRuntimeEnv } from './runtime-env';
import { subscribeClassroomRefresh } from './classroom-events';

export type VoiceLease = {
  id: string; epoch: number; provider: 'qwen' | 'openai'; instructions: string; initialCue: string;
  remainingMs: number; snapshot: ClassroomSnapshot; voice?: string;
  heartbeat(): Promise<{ snapshot: ClassroomSnapshot; instructions: string } | null>;
  started?(sessionId: string): Promise<void>;
  transcript(event: { role: 'child' | 'teacher'; text: string; final: boolean; itemId?: string; contextKey: string; source: 'speech' | 'typed' }): Promise<void>;
  tool(name: string, args: unknown): Promise<{ output: unknown; snapshot: ClassroomSnapshot }>;
  closed(): Promise<void>;
};
export type ClassroomVoiceConfig = {
  key: string; model: string; voice: string; workspaceId?: string; region?: string; childDataReady?: boolean;
};
export type ClassroomSocketOptions = {
  origin: string;
  open(request: Request, id: string): Promise<VoiceLease>;
  config?: (provider: VoiceLease['provider']) => ClassroomVoiceConfig;
  connect?: (url: string, headers: Record<string, string>) => WebSocket;
  heartbeatMs?: number; startupMs?: number; closeMs?: number; utteranceSettleMs?: number; responseAckMs?: number;
};
const MAX_BUFFER = 256_000, MAX_OUTPUT_BYTES = 192_000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const pathPattern = new RegExp(`^/api/v1/classrooms/(${UUID})/stream$`, 'i');
const tools = new Set(CLASSROOM_VOICE_TOOLS.map(tool => tool.name));
const bounded = (value: unknown, length: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= length;
function configFromEnvironment(provider: VoiceLease['provider']): ClassroomVoiceConfig {
  const env = (name: string) => (readRuntimeEnv(name) ?? '').trim();
  return provider === 'qwen'
    ? { key: env('DASHSCOPE_API_KEY'), model: env('QWEN_REALTIME_MODEL') || 'qwen3.8-omni-flash-realtime', voice: env('QWEN_REALTIME_VOICE') || 'Tina', workspaceId: env('DASHSCOPE_WORKSPACE_ID'), region: env('DASHSCOPE_REGION') || 'cn-beijing' }
    : { key: env('OPENAI_API_KEY'), model: env('OPENAI_LIVE_MODEL') || 'gpt-live-1', voice: env('OPENAI_LIVE_VOICE') || 'gleam', childDataReady: env('OPENAI_CHILD_DATA_READY') === 'true' };
}
function sessionCookie(header: string | undefined) {
  const values = (header ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith('teeko_session='));
  return values.length === 1 && /^teeko_session=[A-Za-z0-9_-]{32,128}$/.test(values[0]);
}
function reject(socket: Duplex, status: number) {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : status === 401 ? 'Unauthorized' : 'Unavailable'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
function timed<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error('Operation timed out.')), milliseconds);
    promise.then(value => { clearTimeout(timeout); resolve(value); }, error => { clearTimeout(timeout); rejectPromise(error); });
  });
}
function json(data: WebSocket.RawData): Record<string, unknown> | null {
  try { const value: unknown = JSON.parse(data.toString()); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  catch { return null; }
}

/** Only this process owns provider connections; PostgreSQL lease validation remains authoritative. */
export function attachClassroomSockets(server: Server, options: ClassroomSocketOptions) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32_768, perMessageDeflate: false });
  const connections = new Set<() => Promise<void>>();
  let closing = false, pending = 0;
  const upgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => {});
    const url = new URL(request.url ?? '/', options.origin), match = pathPattern.exec(url.pathname);
    if (!match || url.search || closing) { reject(socket, 404); return; }
    if (request.headers.origin !== options.origin || request.headers['sec-fetch-site'] === 'cross-site') { reject(socket, 403); return; }
    if (!sessionCookie(request.headers.cookie)) { reject(socket, 401); return; }
    if (pending >= 16) { reject(socket, 503); return; }
    pending++;
    let lease: VoiceLease | undefined, cancelled = false;
    try {
      const headers = new Headers();
      headers.set('cookie', request.headers.cookie!); headers.set('origin', options.origin);
      const opening = options.open(new Request(new URL(request.url!, options.origin), { headers }), match[1]);
      opening.then(value => { if (cancelled) void value.closed().catch(() => {}); }, () => {});
      lease = await timed(opening, 8000);
      if (socket.destroyed || closing) { await lease.closed(); return; }
      const defaults = (options.config ?? configFromEnvironment)(lease.provider);
      const config = { ...defaults, ...(lease.voice ? { voice: lease.voice } : {}) };
      if (!config.key || (lease.provider === 'openai' && !config.childDataReady) || !Number.isFinite(lease.remainingMs) || lease.remainingMs <= 0) throw new Error('Voice configuration unavailable.');
      const endpoint = lease.provider === 'qwen'
        ? qwenEndpoint({ workspaceId: config.workspaceId ?? '', model: config.model, region: config.region as QwenRegion, transport: 'websocket' })
        : 'wss://api.openai.com/v1/live/sessions';
      const captured = lease;
      wss.handleUpgrade(request, socket, head, client => ownConnection(client, captured, config, endpoint));
    } catch (error) {
      cancelled = true;
      if (lease) await lease.closed().catch(() => {});
      const status = error && typeof error === 'object' && 'status' in error && [401, 403, 404, 409].includes(Number(error.status)) ? Number(error.status) : 503;
      reject(socket, status);
    } finally { pending--; }
  };

  function ownConnection(client: WebSocket, lease: VoiceLease, config: ClassroomVoiceConfig, endpoint: string) {
    let upstream: WebSocket | undefined, ready = false, stopped = false, finalized = false, persistingStart = false, revision = lease.snapshot.revision;
    let refreshQueued = false, refreshPromise: Promise<void> | undefined, unsubscribeRefresh: () => void = () => {};
    let stepIndex = lease.snapshot.stepIndex, feedbackId = lease.snapshot.feedback?.id, counter = 0, frames = 0, windowStart = Date.now(), messages = 0, lastTextAt = 0, toolsPending = 0;
    let closePromise: Promise<void> | undefined, resolveFinal: (() => void) | undefined;
    const toolsSeen = new Set<string>(), history: { role: 'child' | 'teacher'; text: string }[] = [];
    const pendingDelegations = new Map<string, { contextKey: string; timer: ReturnType<typeof setTimeout> }>();
    let utterance = '', utteranceKey = `${lease.id}:${lease.epoch}:${stepIndex}`, utteranceOverflow = false;
    let voicedMs = 0, silentMs = 0, lastPcmAt = 0, utteranceTimer: ReturnType<typeof setTimeout> | undefined;
    let completedSpeech: { contextKey: string; itemId: string; used: boolean } | undefined, qwenSpeechKey: string | undefined;
    const currentKey = () => `${lease.id}:${lease.epoch}:${stepIndex}`;
    const protocol = lease.provider === 'qwen' ? createQwenProtocol({ model: config.model, voice: config.voice }) : null;
    type QwenQueued = { command?: VoiceCommand; raw?: string; cue: boolean; interrupts: boolean };
    let qwenQueue: QwenQueued[] = [], qwenAwaiting = false, qwenConfigured = false, qwenWantsCancel = false;
    let qwenResponseState: 'idle' | 'pending' | 'active' | 'cancelling' = 'idle';
    let qwenAckTimer: ReturnType<typeof setTimeout> | undefined, qwenResponseTimer: ReturnType<typeof setTimeout> | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const eventId = () => `teeko_${++counter}`;
    const send = (socket: WebSocket | undefined, event: unknown) => {
      if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFER) return false;
      try { socket.send(typeof event === 'string' ? event : JSON.stringify(event)); return true; } catch { return false; }
    };
    const toClient = (event: unknown) => send(client, event);
    const append = (kind: 'thinking' | 'commentary', content: string, delegationId: string | null = null) => {
      const chunks = kind === 'thinking' ? contextChunks(content) : [spokenUpdate(content)];
      let accepted = true;
      for (const chunk of chunks) accepted = send(upstream, { type: `session.${kind}.append`, event_id: eventId(), delegation_id: delegationId, content: chunk }) && accepted;
      return accepted;
    };
    const finish = () => {
      if (finalized) return;
      finalized = true; resolveFinal?.();
      if (upstream?.readyState === WebSocket.OPEN) upstream.close();
      if (upstream?.readyState === WebSocket.CONNECTING) upstream.terminate();
    };
    const stop = (message?: string) => {
      if (closePromise) return closePromise;
      unsubscribeRefresh();
      stopped = true; timers.forEach(timer => clearTimeout(timer)); timers.clear(); clearInterval(heartbeatTimer); clearInterval(pingTimer);
      resetUtterance();
      if (message) toClient({ type: 'error', message });
      toClient({ type: 'interrupt' });
      closePromise = (async () => {
        if (lease.provider === 'openai' && ready && upstream?.readyState === WebSocket.OPEN && !finalized) {
          const wait = new Promise<void>(resolve => { resolveFinal = resolve; });
          send(upstream, { type: 'session.close', event_id: eventId() });
          await timed(wait, options.closeMs ?? 2500).catch(() => {});
        }
        finish();
        if (upstream && upstream.readyState !== WebSocket.CLOSED) { upstream.terminate(); }
        await lease.closed().catch(() => {});
        toClient({ type: 'closed' });
        if (client.readyState === WebSocket.OPEN) client.close(1000);
        connections.delete(stop);
      })();
      return closePromise;
    };
    const fail = () => { void stop('实时语音连接未完成，请检查网络或重新连接。'); };
    const clearQwenTimer = (timer: ReturnType<typeof setTimeout> | undefined) => { if (timer) { clearTimeout(timer); timers.delete(timer); } };
    const awaitQwenResponse = () => {
      clearQwenTimer(qwenResponseTimer);
      qwenResponseTimer = setTimeout(fail, options.responseAckMs ?? 15000); timers.add(qwenResponseTimer);
    };
    const sendQwenRaw = (raw: string) => {
      if (stopped) return;
      const type = (JSON.parse(raw) as { type: string }).type;
      if (type === 'response.create') { qwenResponseState = 'pending'; awaitQwenResponse(); }
      if (!send(upstream, raw)) fail();
    };
    const cancelQwenResponse = () => {
      if (qwenResponseState === 'pending') { qwenWantsCancel = true; return; }
      if (qwenResponseState !== 'active') return;
      qwenWantsCancel = false; qwenResponseState = 'cancelling'; awaitQwenResponse();
      toClient({ type: 'interrupt' });
      sendQwenRaw(JSON.stringify({ type: 'response.cancel' }));
    };
    const pumpQwen = () => {
      if (!protocol || stopped || qwenAwaiting) return;
      const item = qwenQueue[0]; if (!item || (!qwenConfigured && item.command?.type !== 'configure')) return;
      const startsReply = item.raw ? (JSON.parse(item.raw) as { type: string }).type === 'response.create' : item.command && ['speak', 'user_text', 'tool_result', 'commit'].includes(item.command.type);
      if (startsReply && qwenResponseState !== 'idle') {
        if (item.interrupts) cancelQwenResponse();
        return;
      }
      qwenQueue.shift();
      const commands = item.raw ? [item.raw] : protocol.commands(item.command!);
      for (let index = 0; index < commands.length; index++) {
        const raw = commands[index]; if (typeof raw !== 'string') continue;
        const type = (JSON.parse(raw) as { type: string }).type;
        if (type === 'response.cancel') { cancelQwenResponse(); continue; }
        if (type === 'session.update') {
          qwenAwaiting = true; clearQwenTimer(qwenAckTimer);
          qwenAckTimer = setTimeout(fail, options.responseAckMs ?? 15000); timers.add(qwenAckTimer);
          for (const rest of commands.slice(index + 1).reverse()) if (typeof rest === 'string') qwenQueue.unshift({ raw: rest, cue: item.cue, interrupts: item.interrupts });
          sendQwenRaw(raw); return;
        }
        sendQwenRaw(raw);
      }
      pumpQwen();
    };
    const enqueueQwen = (command: VoiceCommand) => {
      if (!protocol || stopped) return;
      if (command.type === 'audio') { for (const raw of protocol.commands(command)) if (typeof raw === 'string') sendQwenRaw(raw); return; }
      if (command.type === 'cancel') { cancelQwenResponse(); return; }
      if (command.type === 'context') qwenQueue = qwenQueue.filter(item => item.command?.type !== 'context');
      if (command.type === 'speak' || command.type === 'tool_result') qwenQueue = qwenQueue.filter(item => !item.cue);
      const item = { command, cue: command.type === 'speak', interrupts: command.type === 'speak' || command.type === 'user_text' };
      if (command.type === 'context') qwenQueue.unshift(item); else qwenQueue.push(item);
      if (qwenQueue.length > 30) { fail(); return; }
      pumpQwen();
    };
    const speak = (cue: string) => {
      if (protocol) enqueueQwen({ type: 'speak', text: cue }); else append('commentary', cue);
    };
    const context = (snapshot: ClassroomSnapshot, instructions: string, cue: boolean) => {
      if (stopped || snapshot.revision < revision) return;
      const taskChanged = snapshot.stepIndex !== stepIndex, feedbackChanged = snapshot.feedback?.id !== feedbackId;
      if (taskChanged) resetUtterance();
      revision = snapshot.revision; stepIndex = snapshot.stepIndex; feedbackId = snapshot.feedback?.id;
      toClient({ type: 'snapshot', classroom: snapshot });
      const step = snapshot.course.steps[snapshot.stepIndex];
      if (protocol) enqueueQwen({ type: 'context', instructions });
      else append('thinking', JSON.stringify({ contextKey: currentKey(), revision: snapshot.revision, courseVersion: snapshot.course.version,
        task: step ? { id: step.id, kind: step.kind, prompt: step.english } : null,
        objects: snapshot.course.pages.find(page => page.id === step?.pageId)?.objects.map(object => ({ id: object.id, label: object.label })),
        teacherObjectIds: snapshot.teacherObjectIds,
        feedback: snapshot.feedback ? { kind: snapshot.feedback.kind, message: snapshot.feedback.message.slice(0, 240) } : null,
      }));
      if (cue && (taskChanged || feedbackChanged)) speak(`Current objective: ${step?.english ?? 'The lesson is finished.'} ${taskChanged
        ? 'Briefly acknowledge the verified previous result, ask this current question naturally, then listen.'
        : `Latest verified feedback: ${snapshot.feedback?.message.slice(0, 100) ?? 'Use the current picture.'} Give one useful clue if needed, then listen without repeating the same demand.`}`);
    };
    const tool = async (callId: string, name: string, args: unknown, delegationId: string | null = null) => {
      if (stopped || toolsSeen.has(callId)) return;
      if (toolsPending >= 3 || toolsSeen.size >= 250) { fail(); return; }
      toolsSeen.add(callId); toolsPending++;
      try {
        const result = await timed(lease.tool(name, args), 10000);
        if (stopped) return;
        const active = await timed(lease.heartbeat(), 5000);
        if (!active) { void stop(); return; }
        if (stopped) return;
        context(active.snapshot, active.instructions, false);
        const output = active.snapshot.revision > result.snapshot.revision
          ? { status: 'unavailable', english: 'The activity changed. Discard this old result and use the current task.' }
          : result.output;
        if (protocol) enqueueQwen({ type: 'tool_result', callId, output: JSON.stringify(output) });
        else {
          const spoken = output as { english?: string } | null;
          append('thinking', JSON.stringify({ verifiedApplicationResult: output }), delegationId);
          append('commentary', spoken && typeof spoken.english === 'string' ? spoken.english : 'The application could not confirm an action. Ask one short clarification and do not invent success.', delegationId);
        }
      } catch {
        if (!stopped) {
          if (protocol) enqueueQwen({ type: 'tool_result', callId, output: JSON.stringify({ status: 'unavailable', english: 'The check did not finish. Please try once more.' }) });
          else append('thinking', 'The application check failed. Do not claim success.', delegationId);
        }
      } finally { toolsPending--; }
    };
    let transcriptChain = Promise.resolve();
    const record = (role: 'child' | 'teacher', text: string, final: boolean, itemId?: string, contextKey = currentKey(), source: 'speech' | 'typed' = 'speech') => {
      if (!bounded(text, 6000)) return;
      history.push({ role, text }); if (history.length > 16) history.shift();
      if (!final) return;
      transcriptChain = transcriptChain.then(() => stopped || contextKey !== currentKey() ? undefined : lease.transcript({ role, text, final, contextKey, source, ...(itemId ? { itemId } : {}) })).catch(fail);
    };
    function resetUtterance() {
      if (utteranceTimer) clearTimeout(utteranceTimer); utteranceTimer = undefined;
      utterance = ''; utteranceOverflow = false; voicedMs = 0; silentMs = 0; completedSpeech = undefined;
      for (const [delegationId, pending] of pendingDelegations) {
        clearTimeout(pending.timer);
        if (!stopped) append('thinking', 'The application task changed. Discard the previous unfinished request.', delegationId);
      }
      pendingDelegations.clear();
    }
    function dispatchDelegation() {
      if (stopped || !completedSpeech || completedSpeech.used || completedSpeech.contextKey !== currentKey()) return;
      const next = [...pendingDelegations].find(([, pending]) => pending.contextKey === currentKey());
      if (!next) return;
      const [delegationId, pending] = next;
      completedSpeech.used = true; pendingDelegations.delete(delegationId); clearTimeout(pending.timer);
      const contextKey = pending.contextKey;
      void transcriptChain.then(() => {
        if (stopped || contextKey !== currentKey()) return;
        return tool(delegationId, 'delegate', { contextKey, history: [...history] }, delegationId);
      });
    }
    function scheduleUtterance() {
      if (utteranceTimer) clearTimeout(utteranceTimer);
      if (stopped || !utterance || utteranceOverflow || voicedMs < 200 || silentMs < 1200) return;
      const key = utteranceKey;
      utteranceTimer = setTimeout(() => {
        utteranceTimer = undefined;
        // GPT-Live exposes fragments, not a final-turn event. Only measured, contiguous
        // low-energy PCM after speech supplies this application's utterance boundary.
        if (stopped || key !== currentKey() || !utterance || utteranceOverflow || silentMs < 1200 || Date.now() - lastPcmAt > 500) return;
        const text = utterance, itemId = randomUUID();
        utterance = ''; voicedMs = 0; silentMs = 0;
        record('child', text, true, itemId, key);
        completedSpeech = { contextKey: key, itemId, used: false };
        dispatchDelegation();
      }, options.utteranceSettleMs ?? 350);
    }
    function observePcm(audio: string) {
      if (protocol) return;
      const pcm = Buffer.from(audio, 'base64'); let energy = 0;
      for (let index = 0; index < pcm.length; index += 2) energy += (pcm.readInt16LE(index) / 32768) ** 2;
      const audible = Math.sqrt(energy / (pcm.length / 2)) >= 0.015;
      lastPcmAt = Date.now();
      if (audible) {
        if (!voicedMs) utteranceKey = currentKey();
        voicedMs += 100; silentMs = 0;
        if (utteranceTimer) clearTimeout(utteranceTimer); utteranceTimer = undefined;
      } else if (voicedMs) {
        silentMs += 100;
        if (silentMs === 1200) scheduleUtterance();
      }
    }
    const becomeReady = () => {
      if (ready || stopped) return;
      ready = true; clearTimeout(startup);
      toClient({ type: 'ready', inputSampleRate: lease.provider === 'qwen' ? 16000 : 24000, outputSampleRate: 24000 });
      toClient({ type: 'snapshot', classroom: lease.snapshot });
      speak(lease.initialCue);
    };
    const providerStarted = async (sessionId: unknown, configure: boolean) => {
      if (persistingStart || ready || stopped) return;
      if (!bounded(sessionId, 200)) { fail(); return; }
      persistingStart = true;
      try {
        if (lease.started) await timed(lease.started(sessionId), 5000);
        if (stopped) return;
        if (configure && protocol) enqueueQwen({ type: 'configure', instructions: lease.instructions, tools: CLASSROOM_VOICE_TOOLS });
        else becomeReady();
      } catch { fail(); }
    };
    const handleUpstream = (data: WebSocket.RawData, binary: boolean) => {
      const length = Array.isArray(data) ? data.reduce((sum, chunk) => sum + chunk.length, 0) : data.byteLength;
      if (binary || length > 512_000) { fail(); return; }
      const event = json(data); if (!event) { fail(); return; }
      if (event.type === 'session.closed') { finish(); void stop(); return; }
      if (stopped) return;
      if (event.type === 'error') { fail(); return; }
      if (protocol) {
        for (const value of protocol.parse(event)) {
          if (value.type === 'session_created') void providerStarted(value.sessionId, true);
          else if (value.type === 'configured') {
            clearQwenTimer(qwenAckTimer); qwenAckTimer = undefined; qwenAwaiting = false; qwenConfigured = true;
            becomeReady(); pumpQwen();
          }
          else if (value.type === 'response_start') {
            if (qwenResponseState !== 'cancelling') { clearQwenTimer(qwenResponseTimer); qwenResponseTimer = undefined; qwenResponseState = 'active'; }
            if (qwenWantsCancel) cancelQwenResponse();
            pumpQwen();
          }
          else if (value.type === 'response_done') {
            clearQwenTimer(qwenResponseTimer); qwenResponseTimer = undefined; qwenResponseState = 'idle'; qwenWantsCancel = false; pumpQwen();
          }
          else if (value.type === 'audio') { if (qwenResponseState !== 'cancelling' && !toClient({ type: 'audio', audio: value.audio, sampleRate: value.sampleRate })) fail(); }
          else if (value.type === 'speech_start') { qwenSpeechKey = currentKey(); toClient({ type: 'interrupt' }); enqueueQwen({ type: 'cancel' }); }
          else if (value.type === 'transcript' && value.final) record(value.role, value.text, true, value.itemId, value.role === 'child' ? qwenSpeechKey ?? currentKey() : currentKey());
          else if (value.type === 'tool' && tools.has(value.name)) {
            try { const args: unknown = JSON.parse(value.arguments); void transcriptChain.then(() => tool(value.callId, value.name, args)); } catch { fail(); }
          }
          else if (value.type === 'error') fail();
        }
      } else {
        if (event.type === 'session.started') void providerStarted((event.session as { id?: unknown } | undefined)?.id, false);
        else if (event.type === 'session.output_audio.delta' && bounded(event.delta, Math.ceil(MAX_OUTPUT_BYTES / 3) * 4)) {
          if (!toClient({ type: 'audio', audio: event.delta, sampleRate: 24000 })) fail();
        } else if ((event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') && bounded(event.delta, 6000)) {
          record(event.type === 'session.input_transcript.delta' ? 'child' : 'teacher', event.delta, false);
          if (event.type === 'session.input_transcript.delta') {
            if (!voicedMs) return;
            if (!utterance) utteranceKey = currentKey();
            if (utteranceKey !== currentKey()) return;
            if (utterance.length + event.delta.length > 1000) utteranceOverflow = true;
            else utterance += event.delta;
            scheduleUtterance();
          }
        } else if (event.type === 'session.delegation.created') {
          const delegation = event.delegation as { id?: unknown; target?: unknown } | undefined;
          if (delegation?.target === 'client' && bounded(delegation.id, 200)) {
            append('thinking', '', delegation.id);
            const delegationId = delegation.id;
            if (toolsSeen.has(delegationId) || pendingDelegations.has(delegationId)) return;
            if (pendingDelegations.size >= 3) { append('thinking', 'Wait for the learner to finish the current answer. No completed answer has been confirmed.', delegationId); return; }
            const timer = setTimeout(() => { pendingDelegations.delete(delegationId); if (!stopped) append('thinking', 'No completed learner answer is confirmed yet. Keep listening and never grade a fragment.', delegationId); }, 8000);
            pendingDelegations.set(delegationId, { contextKey: currentKey(), timer });
            dispatchDelegation();
          }
        }
      }
    };
    let alive = true;
    client.on('pong', () => { alive = true; });
    const pingTimer = setInterval(() => {
      if (!alive) { client.terminate(); void stop(); return; }
      alive = false;
      try { client.ping(); } catch { void stop(); }
    }, 15000);
    const refreshConnection = (): Promise<void> => {
      if (stopped) return Promise.resolve();
      refreshQueued = true;
      if (refreshPromise) return refreshPromise;
      refreshPromise = (async () => {
        await Promise.resolve();
        try {
          while (refreshQueued && !stopped) {
            refreshQueued = false;
            try {
              const heartbeat = await timed(lease.heartbeat(), 5000);
              if (!heartbeat) { void stop(); return; }
              if (ready && heartbeat.snapshot.revision !== revision) context(heartbeat.snapshot, heartbeat.instructions, true);
            } catch { void stop('课堂连接已停止，请重新连接。'); return; }
          }
        } finally { refreshPromise = undefined; }
      })();
      return refreshPromise;
    };
    const heartbeatTimer = setInterval(() => { void refreshConnection(); }, options.heartbeatMs ?? 2000);
    unsubscribeRefresh = subscribeClassroomRefresh(lease.id, refreshConnection);
    const startup = setTimeout(() => { void stop('语音服务连接超时，请重试。'); }, options.startupMs ?? 20000);
    timers.add(startup);
    const deadline = setTimeout(() => { void stop('本次课堂已到时间，请查看课堂小结。'); }, Math.min(lease.remainingMs, 2_147_483_647)); timers.add(deadline);
    connections.add(stop);
    client.on('close', () => { void stop(); }); client.on('error', () => { void stop(); });
    client.on('message', (data, binary) => {
      if (stopped) return;
      if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); messages = 0; frames = 0; }
      if (++messages > 24 || binary) { fail(); return; }
      const event = json(data);
      if (!event || !['audio', 'text', 'ping', 'close', 'mute'].includes(String(event.type))) { fail(); return; }
      if (event.type === 'close') { void stop(); return; }
      if (event.type === 'ping') { toClient({ type: 'pong' }); return; }
      if (!ready) return;
      if (event.type === 'audio') {
        const expected = lease.provider === 'qwen' ? 3200 : 4800;
        if (++frames > 16 || !bounded(event.audio, Math.ceil(expected / 3) * 4) || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.audio) || Buffer.from(event.audio, 'base64').length !== expected) { fail(); return; }
        observePcm(event.audio);
        if (protocol) enqueueQwen({ type: 'audio', audio: event.audio });
        else if (!send(upstream, { type: 'session.input_audio.append', audio: event.audio })) fail();
      } else if (event.type === 'text') {
        if (!bounded(event.text, 1000) || Date.now() - lastTextAt < 500) { fail(); return; }
        lastTextAt = Date.now();
        const text = event.text, contextKey = currentKey(), itemId = randomUUID();
        record('child', text, true, itemId, contextKey, 'typed');
        void transcriptChain.then(() => {
          if (stopped || contextKey !== currentKey()) return;
          if (protocol) enqueueQwen({ type: 'user_text', text });
          else { append('thinking', `Learner typed reference data: ${JSON.stringify(text)}`); void tool(randomUUID(), 'delegate', { contextKey, typed: true }); }
        });
      } else if (event.type === 'mute' && typeof event.muted === 'boolean' && !protocol) {
        send(upstream, { type: event.muted ? 'session.input_audio.mute' : 'session.input_audio.unmute', event_id: eventId() });
      }
    });
    try {
      upstream = (options.connect ?? ((url, headers) => new WebSocket(url, { headers, maxPayload: 512_000, handshakeTimeout: 15000, perMessageDeflate: false })))(endpoint, { Authorization: `Bearer ${config.key}`, ...(lease.provider === 'openai' ? { 'OpenAI-Safety-Identifier': createHash('sha256').update(lease.id).digest('hex') } : {}) });
      upstream.on('message', handleUpstream);
      upstream.on('error', fail);
      upstream.on('close', () => { finish(); void stop(); });
      upstream.on('open', () => {
        if (stopped) { upstream?.terminate(); return; }
        if (lease.provider === 'openai') send(upstream, {
          type: 'session.start', event_id: eventId(),
          session: { model: config.model, store: false, instructions: lease.instructions, audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: config.voice } }, delegation: { type: 'client', acknowledgement_delay_ms: 800 }, input: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: lease.initialCue }] }] },
        });
      });
    } catch { fail(); }
  }
  const upgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => { void upgrade(request, socket, head); };
  server.on('upgrade', upgradeListener);
  return {
    async close() {
      closing = true; server.off('upgrade', upgradeListener);
      await Promise.allSettled([...connections].map(close => close()));
      for (const client of wss.clients) client.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
    },
  };
}
