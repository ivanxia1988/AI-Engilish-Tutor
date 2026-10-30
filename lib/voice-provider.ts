export const VOICE_PROVIDER_IDS = ['openai', 'qwen', 'doubao', 'glm'] as const;
export type VoiceProviderId = typeof VOICE_PROVIDER_IDS[number];
export type VoiceTransportKind = 'webrtc_direct' | 'websocket_relay';
export const VOICE_PROVIDERS: Record<VoiceProviderId, { name: string; transport: VoiceTransportKind; description: string }> = {
  openai: { name: 'GPT-Live', transport: 'webrtc_direct', description: '原有课堂 · 浏览器 WebRTC 连接语音服务' },
  qwen: { name: '阿里百炼 · 通义实时', transport: 'webrtc_direct', description: '浏览器 WebRTC 直连 · 需百炼工作空间与密钥' },
  doubao: { name: '豆包 · 实时语音 3.0', transport: 'websocket_relay', description: '网站后端 WebSocket 转发 · 耗时包含中转线路' },
  glm: { name: '智谱 · GLM 实时', transport: 'websocket_relay', description: '网站后端 WebSocket 转发 · 耗时包含中转线路' },
};
export type VoiceProviderStatus = { id: VoiceProviderId; name: string; transport: VoiceTransportKind; configured: boolean; model: string; missing: string[] };
export function voiceProvider(value: unknown): VoiceProviderId { return typeof value === 'string' && (VOICE_PROVIDER_IDS as readonly string[]).includes(value) ? value as VoiceProviderId : 'openai'; }
export const voicePathLabel = (transport: VoiceTransportKind) => transport === 'webrtc_direct' ? '浏览器 WebRTC 直连' : '网站后端 WebSocket 转发';
