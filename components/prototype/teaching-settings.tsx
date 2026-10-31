'use client';
import { Check, Volume2 } from 'lucide-react';
import type { TeachingPreferences } from '../../lib/prototype-teaching';
import { ProviderConnectionCheck } from './provider-connection-check';

function Choices<T extends string>({ title, name, value, options, onChange }: { title: string; name: string; value: T; options: readonly { value: T; title: string; detail?: string }[]; onChange: (value: T) => void }) {
  return <fieldset className="tp-teaching-group"><legend>{title}</legend><div className="tp-teaching-options">{options.map(option => <label key={option.value} className={`tp-teaching-option ${value === option.value ? 'is-selected' : ''}`}><input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} /><span><strong>{option.title}</strong>{option.detail && <small>{option.detail}</small>}</span></label>)}</div></fieldset>;
}

export function TeachingSettings({ value, onChange, onSave, onPreview }: { value: TeachingPreferences; onChange: (value: Partial<TeachingPreferences>) => void; onSave: () => void; onPreview: () => void }) {
  return <><section className="tp-card tp-teaching-panel tp-teaching-expanded"><div className="tp-teaching-main">
    <Choices title="授课语言" name="teaching-language" value={value.language} options={[{ value: 'english', title: '全英文', detail: '讲解和提示都用英语' }, { value: 'assisted', title: '允许中文辅助', detail: '以英语为主，卡住时用中文解释' }]} onChange={language => onChange({ language })} />
    <Choices title="老师风格" name="teaching-style" value={value.style} options={[{ value: 'gentle', title: '温柔', detail: '多鼓励，耐心引导' }, { value: 'serious', title: '认真', detail: '讲解细致，关注表达' }, { value: 'strict', title: '严厉', detail: '要求更明确，及时纠正' }]} onChange={style => onChange({ style })} />
    <Choices title="老师声音" name="teaching-voice" value={value.voice} options={[{ value: 'female', title: '女声' }, { value: 'male', title: '男声' }]} onChange={voice => onChange({ voice })} />
  </div><div className="tp-teaching-services">
    <Choices title="语音服务" name="teaching-provider" value={value.provider} options={[{ value: 'qwen', title: '通义' }, { value: 'openai', title: 'GPT Live' }]} onChange={provider => onChange({ provider })} />
    {value.provider === 'openai' && <p className="tp-vpn-note">GPT Live 需要当前网络能访问服务；若连接失败，请检查 VPN／代理是否对当前浏览器生效。</p>}
    <ProviderConnectionCheck key={value.provider} provider={value.provider} />
    <div className="tp-effects-setting"><div><strong>互动音效</strong><span>短提示音与庆祝音</span></div><button type="button" className={`tp-switch ${value.effects ? 'is-on' : ''}`} role="switch" aria-label="互动音效" aria-checked={value.effects} onClick={() => onChange({ effects: !value.effects })}><span /></button><button type="button" className="tp-sound-preview" disabled={!value.effects} onClick={onPreview}><Volume2 size={15} />试听</button></div>
  </div></section><footer className="tp-page-actions"><button type="button" className="tp-button tp-primary" onClick={onSave}><Check size={17} />保存设置</button></footer></>;
}
