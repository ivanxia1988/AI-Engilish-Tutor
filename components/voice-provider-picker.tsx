"use client";
import { useId } from 'react';
import { VOICE_PROVIDER_IDS, VOICE_PROVIDERS, voiceProvider, voicePathLabel, type VoiceProviderId, type VoiceProviderStatus } from '@/lib/voice-provider';

/** Old status responses only knew GPT-Live. Never infer another vendor is ready. */
export function resolvedVoiceStatuses(statuses: VoiceProviderStatus[] | undefined, fallbackLiveReady = false): VoiceProviderStatus[] {
  return VOICE_PROVIDER_IDS.map(id => {
    const status = Array.isArray(statuses) ? statuses.find(value => value?.id === id) : undefined;
    return {
      id, name: VOICE_PROVIDERS[id].name, transport: VOICE_PROVIDERS[id].transport,
      configured: status ? status.configured === true : statuses === undefined && id === 'openai' && fallbackLiveReady,
      model: typeof status?.model === 'string' ? status.model : '',
      missing: Array.isArray(status?.missing) ? status.missing.filter(value => typeof value === 'string') : [],
    };
  });
}

export function VoiceProviderPicker({ value, statuses, locked = false, onChange, onRefresh }: { value: VoiceProviderId; statuses: VoiceProviderStatus[]; locked?: boolean; onChange: (value: VoiceProviderId) => void; onRefresh?: () => void }) {
  const inputId = useId(), provider = voiceProvider(value);
  const choices = resolvedVoiceStatuses(statuses), current = choices.find(choice => choice.id === provider)!;
  const descriptionId = `${inputId}-description`;
  return <section className={`voice-provider-picker ${current.configured ? 'voice-provider-ready' : 'voice-provider-pending'}`} aria-label="实时语音服务选择">
    <div className="voice-provider-heading"><label htmlFor={inputId}>实时语音服务</label>{onRefresh && <button className="text-button" onClick={onRefresh}>检查服务配置</button>}</div>
    <select id={inputId} value={provider} disabled={locked} aria-describedby={descriptionId} onChange={event => { if (!locked) onChange(voiceProvider(event.target.value)); }}>
      {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}{choice.configured ? ' · 已配置' : ' · 待配置'}</option>)}
    </select>
    <div id={descriptionId} className="voice-provider-description">
      <strong>{VOICE_PROVIDERS[provider].name}</strong><span className="voice-provider-path">{voicePathLabel(current.transport)}</span>
      <p className="voice-provider-status">{current.configured ? '服务已配置 · 本次连接后记录实测结果' : '待配置，尚未实测'}</p>
      <p>{current.transport === 'webrtc_direct' ? '网站后端负责鉴权建连，声音在浏览器与所选语音服务之间传输。' : '声音经过网站托管后端，测试耗时包含中转线路；不代表国内端到端线路。'}</p>
      {provider === 'doubao' && <p>此服务支持语音问答；文字提问暂未接入，已知对象的文字画圈指令仍可使用。</p>}
      {locked ? <p className="voice-provider-lock" role="status">请先结束实时课堂，再切换语音服务。</p> : <p>切换仅保存选择；点击“开始实时课堂”后才建立语音连接。</p>}
    </div>
    <details className="voice-provider-config-help"><summary>服务端配置帮助</summary><p>密钥只由服务器保管，不在孩子的网页中填写。</p>{current.configured ? <p>所需配置已就绪。配置成功不代表已验证实际连接、听感或时延。</p> : current.missing.length ? <><p>请在网站服务端配置以下项目，再检查服务配置：</p><ul>{current.missing.map(name => <li key={name}><code>{name}</code></li>)}</ul></> : <p>当前未获得这家服务的完整配置信息，请检查服务配置。</p>}{current.model && <p>模型：<code>{current.model}</code></p>}</details>
  </section>;
}
