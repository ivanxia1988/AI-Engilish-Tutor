import { z } from 'zod';
import { ApiError, readJson } from './http';
import { isReceiveOnlyOffer, liveContextSchema, liveSessionSchema, type LiveContext } from './live-protocol';
import { makeLiveTicket, verifyLiveTicket } from './live-ticket';
import { CLASSROOM_VOICE_TOOLS, voiceInstructions } from './voice-instructions';
import { qwenEndpoint, type QwenRegion } from './voice-providers/qwen';
import { createDoubaoProtocol, DOUBAO_VOICE_ENDPOINT } from './voice-providers/doubao';
import { createGLMProtocol } from './voice-providers/glm';
import type { DomesticProviderId, VoiceCommand, VoiceEvent, VoiceWire } from './voice-providers/types';
import { ServerTimer } from './server-timing';

type RelayProvider = 'doubao' | 'glm';
export type VoiceServerConfig = { key: string; model: string; voice: string; workspaceId: string; region: string };
export type VoiceAuthorize = (request: Request) => Promise<{ userId: string }>;
export type VoiceSessionDependencies = { authorize: VoiceAuthorize; config: (provider: DomesticProviderId) => VoiceServerConfig; fetch?: typeof fetch; uuid?: () => string; now?: () => number };
const relayProvider = z.enum(['doubao', 'glm']);
const sessionSchema = z.union([
  z.object({ provider: z.literal('qwen'), mode: z.literal('probe'), sdp: z.string() }).strict(),
  z.object({ provider: z.literal('qwen'), mode: z.literal('classroom'), consent: z.literal(true), context: liveContextSchema, sdp: z.string() }).strict(),
  z.object({ provider: relayProvider, mode: z.literal('probe') }).strict(),
  z.object({ provider: relayProvider, mode: z.literal('classroom'), consent: z.literal(true), context: liveContextSchema }).strict(),
]);
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const error = (status: number, message: string) => Response.json({ error: message }, { status, headers: noStore });
export function voiceServerError(value: unknown) {
  if (value instanceof ApiError) return error(value.status, value.message);
  if (value instanceof z.ZodError) return error(400, '实时语音请求格式不正确，请重新打开课堂。');
  return error(502, '实时语音服务暂时无法连接，请检查服务配置或稍后重试。');
}
function requireConfigured(id: DomesticProviderId, config: VoiceServerConfig) {
  if (!config.key || (id === 'qwen' && !config.workspaceId)) throw new ApiError(503, '所选语音服务尚未配置，请先在服务器添加该服务的密钥。');
}
async function responseText(response: Response, max = 120_000) {
  const reader = response.body?.getReader(); if (!reader) throw new ApiError(502, '语音服务没有返回连接信息。');
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) { const part = await reader.read(); if (part.done) break; total += part.value.length; if (total > max) { await reader.cancel(); throw new ApiError(502, '语音服务返回的连接信息异常。'); } chunks.push(part.value); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

/** No relay audio connection is opened by this HTTP endpoint. Browser keys are never returned. */
export async function handleVoiceSession(request: Request, deps: VoiceSessionDependencies): Promise<Response> {
  const timer = new ServerTimer('session'); let model: string | undefined;
  try {
    const user = await deps.authorize(request);
    const body = sessionSchema.parse(await readJson(request, 180_000));
    const config = deps.config(body.provider); requireConfigured(body.provider, config); model = config.model;
    const sessionId = `voice_${body.provider}_${body.mode}_${(deps.uuid || (() => crypto.randomUUID()))()}`;
    let sdp: string | undefined;
    if (body.provider === 'qwen') {
      const { provider: _provider, ...offer } = body;
      const validated = liveSessionSchema.parse(offer);
      if (validated.mode === 'probe' && !isReceiveOnlyOffer(validated.sdp)) throw new ApiError(400, '连接测试必须关闭发送音频，只接收连接状态。');
      let endpoint: string;
      try { endpoint = qwenEndpoint({ workspaceId: config.workspaceId, model: config.model, region: config.region as QwenRegion }); }
      catch { throw new ApiError(503, '通义实时语音的业务空间、地域或模型配置无效。'); }
      sdp = await timer.upstream(async () => {
        const upstream = await (deps.fetch || fetch)(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/sdp' }, body: validated.sdp, signal: AbortSignal.timeout(35_000) });
        if (!upstream.ok) throw new ApiError(upstream.status === 429 ? 429 : 502, upstream.status === 429 ? '通义实时语音暂时繁忙或额度不足。' : '通义实时语音未能创建连接，请检查服务配置。');
        return await responseText(upstream);
      });
      if (!sdp.startsWith('v=0') || !sdp.includes('m=audio') || !sdp.includes('m=application')) throw new ApiError(502, '通义没有返回有效的实时连接信息。');
    }
    const ticket = await makeLiveTicket(config.key, sessionId, user.userId, (deps.now || Date.now)());
    const timing = timer.finish(200, model);
    return Response.json({ provider: body.provider, model: config.model, voice: config.voice, transport: body.provider === 'qwen' ? 'webrtc_direct' : 'websocket_relay', sessionId, ticket, closeToken: ticket, sdp: sdp || '', performance: timing.performance, ...(!sdp ? { wsPath: '/api/voice/stream' } : {}) }, { headers: { ...noStore, ...timing.headers } });
  } catch (value) { return timer.error(voiceServerError(value), model); }
}

export async function authorizeVoiceUpgrade(request: Request, authorize: VoiceAuthorize) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new ApiError(403, '请从当前网站打开实时语音。');
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') throw new ApiError(426, '此接口仅接受实时语音连接。');
  return await authorize(request);
}

export type VoiceSocket = {
  send(data: VoiceWire): void; close(code?: number, reason?: string): void; accept?(): void;
  addEventListener(type: 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void): void;
  removeEventListener(type: 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void): void;
};
const openSchema = z.object({ type: z.literal('voice.open'), provider: relayProvider, sessionId: z.string().max(150), ticket: z.string().max(1500), context: liveContextSchema.optional() }).strict();
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('voice.context'), context: liveContextSchema }).strict(),
  z.object({ type: z.literal('voice.speak'), text: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('voice.text'), text: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('voice.audio'), audio: z.string().min(4).max(60_000).refine(value => value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) }).strict(),
  z.object({ type: z.literal('voice.mute'), muted: z.boolean() }).strict(),
  z.object({ type: z.literal('voice.cancel') }).strict(),
  z.object({ type: z.literal('voice.tool_result'), callId: z.string().min(1).max(300), output: z.string().max(12_000) }).strict(),
  z.object({ type: z.literal('voice.close') }).strict(),
  z.object({ type: z.literal('voice.ping'), id: z.string().min(1).max(80) }).strict(),
]);
type BridgeOptions = {
  userId: string; config: (provider: RelayProvider) => VoiceServerConfig;
  connect?: (provider: RelayProvider, config: VoiceServerConfig) => Promise<VoiceSocket>;
  fetch?: typeof fetch; now?: () => number;
  setTimeout?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
};
const endpoint = (id: RelayProvider) => id === 'doubao' ? DOUBAO_VOICE_ENDPOINT : 'wss://open.bigmodel.cn/api/paas/v4/realtime';
export async function openVoiceUpstream(id: RelayProvider, config: VoiceServerConfig, request: typeof fetch = fetch): Promise<VoiceSocket> {
  const headers = new Headers({ Upgrade: 'websocket' });
  if (id === 'doubao') headers.set('X-Api-Key', config.key); else headers.set('Authorization', `Bearer ${config.key}`);
  const response = await request(endpoint(id).replace(/^wss:/, 'https:'), { headers, signal: AbortSignal.timeout(15_000) }) as Response & { webSocket?: VoiceSocket | null };
  if (response.status !== 101 || !response.webSocket) throw new Error('Voice upgrade failed.');
  return response.webSocket;
}

/** The bridge holds audio only while forwarding it; it never persists payloads or logs text. */
export function createVoiceBridge(browser: VoiceSocket, options: BridgeOptions) {
  const now = options.now || Date.now, schedule = options.setTimeout || setTimeout, unschedule = options.clearTimeout || clearTimeout;
  let upstream: VoiceSocket | null = null, closed = false, opening = false, authenticated = false, configured = false, probe = false;
  let context: LiveContext | undefined;
  let protocol: ReturnType<typeof createGLMProtocol> | ReturnType<typeof createDoubaoProtocol> | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>(), toolIds = new Set<string>(), upstreamEventIds = new Set<string>();
  let windowAt = now(), messageCount = 0, controlCount = 0, audioBytes = 0;
  const timer = (callback: () => void, milliseconds: number) => { const handle = schedule(() => { timers.delete(handle); callback(); }, milliseconds); timers.add(handle); return handle; };
  const clear = (handle: ReturnType<typeof setTimeout>) => { unschedule(handle); timers.delete(handle); };
  const send = (event: VoiceEvent | { type: 'voice.pong'; id: string }) => { if (!closed) browser.send(JSON.stringify(event)); };
  const close = () => {
    if (closed) return; closed = true;
    for (const handle of timers) unschedule(handle); timers.clear(); toolIds.clear(); upstreamEventIds.clear();
    browser.removeEventListener('message', onMessage); browser.removeEventListener('close', onClose); browser.removeEventListener('error', onClose);
    if (upstream) { upstream.removeEventListener('message', onUpstreamMessage); upstream.removeEventListener('close', onUpstreamClose); upstream.removeEventListener('error', onUpstreamError); try { for (const message of protocol?.commands({ type: 'close' }) || []) upstream.send(message); } catch {} try { upstream.close(1000, 'Classroom ended'); } catch {} }
    try { browser.close(1000, 'Classroom ended'); } catch {}
  };
  const fail = (code: string, message: string) => { try { send({ type: 'error', code, message }); } catch {} close(); };
  const transmit = (command: VoiceCommand) => { if (!upstream || !protocol || closed) return; for (const data of protocol.commands(command)) upstream.send(data); };
  const firstTimer = timer(() => fail('open_timeout', '实时语音验证超时，请重新连接。'), 5000);
  function onClose() { close(); }
  function onUpstreamClose() { try { send({ type: 'closed' }); } finally { close(); } }
  function onUpstreamError() { fail('upstream_connection', '语音服务连接中断，请重新连接。'); }
  function onUpstreamMessage(message: { data?: unknown }) {
    if (closed || !protocol) return;
    try {
      const data = message.data instanceof ArrayBuffer ? new TextDecoder().decode(message.data) : message.data;
      if (typeof data !== 'string' || new TextEncoder().encode(data).byteLength > 1_000_000) { fail('upstream_frame', '语音服务返回的数据异常。'); return; }
      const metadata = JSON.parse(data) as { event_id?: unknown } | null;
      const eventId = metadata && typeof metadata.event_id === 'string' && metadata.event_id.length <= 300 ? metadata.event_id : null;
      if (eventId) { if (upstreamEventIds.has(eventId)) return; upstreamEventIds.add(eventId); if (upstreamEventIds.size > 512) upstreamEventIds.delete(upstreamEventIds.values().next().value!); }
      for (const event of protocol.parse(data)) {
        if (event.type === 'configured') configured = true;
        if (probe && !['session_created', 'configured', 'error', 'closed'].includes(event.type)) continue;
        if (event.type === 'tool') { if (!CLASSROOM_VOICE_TOOLS.some(tool => tool.name === event.name) || toolIds.size >= 20) { fail('tool_invalid', '语音老师返回了无法处理的课堂动作。'); return; } toolIds.add(event.callId); }
        send(event);
        if (event.type === 'closed') { close(); return; }
      }
    } catch { fail('upstream_payload', '语音服务返回的数据无法处理，请重新连接。'); }
  }
  async function open(raw: unknown) {
    try {
      const message = openSchema.parse(raw), config = options.config(message.provider); requireConfigured(message.provider, config);
      const match = /^voice_(doubao|glm)_(probe|classroom)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(message.sessionId);
      if (!match || match[1] !== message.provider || !await verifyLiveTicket(config.key, message.ticket, message.sessionId, options.userId, now())) throw new ApiError(403, '实时语音会话已失效，请重新连接。');
      probe = match[2] === 'probe';
      if (probe ? Boolean(message.context) : !message.context) throw new ApiError(400, '连接测试和课堂模式不能互相切换。');
      if (closed) return;
      authenticated = true; context = message.context; clear(firstTimer);
      timer(() => fail('session_limit', '本次实时语音已满十分钟，请结束后重新连接。'), 10 * 60_000);
      const connectionTimer = timer(() => fail('upstream_timeout', '连接语音服务超时，请稍后重新连接。'), 15_000);
      const socket = await (options.connect || ((id, value) => openVoiceUpstream(id, value, options.fetch)))(message.provider, config);
      if (closed) { try { socket.close(1000, 'Classroom ended'); } catch {} return; }
      upstream = socket; clear(connectionTimer);
      const protocolOptions = { model: config.model, voice: config.voice };
      protocol = message.provider === 'glm' ? createGLMProtocol(protocolOptions) : createDoubaoProtocol(protocolOptions);
      upstream.addEventListener('message', onUpstreamMessage); upstream.addEventListener('close', onUpstreamClose); upstream.addEventListener('error', onUpstreamError); upstream.accept?.();
      transmit({ type: 'configure', instructions: voiceInstructions(context), tools: probe ? [] : CLASSROOM_VOICE_TOOLS });
    } catch (value) { fail('voice_open', value instanceof ApiError ? value.message : '实时语音验证或连接失败，请检查配置后重连。'); }
  }
  function onMessage(message: { data?: unknown }) {
    if (closed) return;
    const data = message.data;
    if (typeof data !== 'string' || new TextEncoder().encode(data).byteLength > 65_536) { fail('frame_limit', '实时语音消息过大或格式不正确。'); return; }
    if (now() - windowAt >= 1000) { windowAt = now(); messageCount = 0; controlCount = 0; audioBytes = 0; }
    if (++messageCount > 100) { fail('message_rate', '实时语音消息过于频繁，请重新连接。'); return; }
    let raw: unknown;
    try { raw = JSON.parse(data); } catch { fail('invalid_json', '实时语音消息格式不正确。'); return; }
    if (!opening) { opening = true; void open(raw); return; }
    try {
      const command = commandSchema.parse(raw);
      if (command.type === 'voice.close') { close(); return; }
      if (!authenticated || !upstream) throw new Error('Not authenticated.');
      if (command.type === 'voice.ping') { send({ type: 'voice.pong', id: command.id }); return; }
      if (probe) throw new Error('Silent probe rejects classroom commands.');
      if (!configured) throw new Error('Session not configured.');
      if (command.type !== 'voice.audio' && ++controlCount > 20) { fail('control_rate', '课堂操作过于频繁，请稍后重新连接。'); return; }
      switch (command.type) {
        case 'voice.audio': {
          audioBytes += command.audio.length * .75;
          if (audioBytes > protocol!.inputSampleRate * 2 * 1.5) { fail('audio_rate', '音频发送速度异常，请重新连接。'); return; }
          transmit({ type: 'audio', audio: command.audio }); break;
        }
        case 'voice.context': context = command.context; transmit({ type: 'context', instructions: voiceInstructions(context) }); break;
        case 'voice.speak': transmit({ type: 'speak', text: command.text }); break;
        case 'voice.text': transmit({ type: 'user_text', text: command.text }); break;
        case 'voice.mute': transmit({ type: 'mute', muted: command.muted }); break;
        case 'voice.cancel': toolIds.clear(); transmit({ type: 'cancel' }); break;
        case 'voice.tool_result': if (toolIds.delete(command.callId)) transmit({ type: 'tool_result', callId: command.callId, output: command.output }); break;
      }
    } catch { fail('invalid_command', '实时语音操作无效或会话尚未准备好，请重新连接。'); }
  }
  browser.addEventListener('message', onMessage); browser.addEventListener('close', onClose); browser.addEventListener('error', onClose);
  return { close };
}
