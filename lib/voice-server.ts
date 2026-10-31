import { readRuntimeEnv } from './server/runtime-env';
import { aiConfig } from './ai';
import { VOICE_PROVIDERS, type VoiceProviderId, type VoiceProviderStatus } from './voice-provider';
export function voiceEnv(name: string): string { return (readRuntimeEnv(name) || '').trim(); }
export function domesticConfig(id: Exclude<VoiceProviderId, 'openai'>) {
  if (id === 'qwen') return { key: voiceEnv('DASHSCOPE_API_KEY'), workspaceId: voiceEnv('DASHSCOPE_WORKSPACE_ID'), model: voiceEnv('QWEN_REALTIME_MODEL') || 'qwen3.8-omni-flash-realtime', voice: voiceEnv('QWEN_REALTIME_VOICE') || 'Tina', region: voiceEnv('DASHSCOPE_REGION') || 'cn-beijing' };
  if (id === 'doubao') return { key: voiceEnv('VOLCENGINE_VOICE_API_KEY'), model: voiceEnv('DOUBAO_REALTIME_MODEL') || '1.2.6.1', voice: voiceEnv('DOUBAO_REALTIME_VOICE') || '', workspaceId: '', region: '' };
  return { key: voiceEnv('ZHIPU_API_KEY'), model: voiceEnv('GLM_REALTIME_MODEL') || 'glm-realtime-flash', voice: voiceEnv('GLM_REALTIME_VOICE') || 'tongtong', workspaceId: '', region: '' };
}
// WebSocket callbacks may run outside the HTTP request's async context.
export function captureRelayVoiceConfig() {
  const configurations = { doubao: domesticConfig('doubao'), glm: domesticConfig('glm') };
  return (id: 'doubao' | 'glm') => configurations[id];
}
export function voiceStatuses(): VoiceProviderStatus[] {
  const ai = aiConfig();
  return (Object.keys(VOICE_PROVIDERS) as VoiceProviderId[]).map(id => {
    if (id === 'openai') return { id, name: VOICE_PROVIDERS[id].name, transport: VOICE_PROVIDERS[id].transport, configured: Boolean(ai.key && ai.childDataReady), model: ai.liveModel, missing: [...(!ai.key ? ['OPENAI_API_KEY'] : []), ...(!ai.childDataReady ? ['OPENAI_CHILD_DATA_READY'] : [])] };
    const config = domesticConfig(id); const keyName = id === 'qwen' ? 'DASHSCOPE_API_KEY' : id === 'doubao' ? 'VOLCENGINE_VOICE_API_KEY' : 'ZHIPU_API_KEY';
    const missing = [...(!config.key ? [keyName] : []), ...(id === 'qwen' && !config.workspaceId ? ['DASHSCOPE_WORKSPACE_ID'] : [])];
    return { id, name: VOICE_PROVIDERS[id].name, transport: VOICE_PROVIDERS[id].transport, model: config.model, configured: missing.length === 0, missing };
  });
}
