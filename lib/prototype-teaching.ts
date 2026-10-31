export interface TeachingPreferences {
  language: 'english' | 'assisted';
  style: 'gentle' | 'serious' | 'strict';
  voice: 'female' | 'male';
  provider: 'openai' | 'qwen';
  effects: boolean;
}

interface TeachingSettings {
  saved: TeachingPreferences;
  draft: TeachingPreferences;
}

type TeachingAction = { type: 'change'; value: Partial<TeachingPreferences> } | { type: 'save' | 'open' } | { type: 'sound'; enabled: boolean };

export function createTeachingSettings(): TeachingSettings {
  const saved: TeachingPreferences = { language: 'assisted', style: 'gentle', voice: 'female', provider: 'qwen', effects: true };
  return { saved, draft: { ...saved } };
}

export function teachingSettingsReducer(state: TeachingSettings, action: TeachingAction): TeachingSettings {
  if (action.type === 'change') return { ...state, draft: { ...state.draft, ...action.value } };
  if (action.type === 'sound') return { saved: { ...state.saved, effects: action.enabled }, draft: { ...state.draft, effects: action.enabled } };
  if (action.type === 'save') return { ...state, saved: { ...state.draft } };
  return { ...state, draft: { ...state.saved } };
}
