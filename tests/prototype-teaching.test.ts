import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeachingSettings, teachingSettingsReducer } from '../lib/prototype-teaching.ts';

test('teaching edits require save and survive reopening after save', () => {
  const initial = createTeachingSettings();
  const edited = teachingSettingsReducer(initial, { type: 'change', value: { language: 'english', style: 'strict', voice: 'male' } });
  assert.deepEqual(initial.saved, { language: 'assisted', style: 'gentle', voice: 'female', provider: 'qwen', effects: true });
  assert.deepEqual(edited.saved, initial.saved);
  const saved = teachingSettingsReducer(edited, { type: 'save' });
  assert.deepEqual(saved.saved, { language: 'english', style: 'strict', voice: 'male', provider: 'qwen', effects: true });
  const reopened = teachingSettingsReducer(saved, { type: 'open' });
  assert.deepEqual(reopened.draft, saved.saved);
});

test('provider is saved explicitly and classroom sound toggling does not save other drafts', () => {
  let state = teachingSettingsReducer(createTeachingSettings(), { type: 'change', value: { provider: 'openai', language: 'english' } });
  state = teachingSettingsReducer(state, { type: 'sound', enabled: false });
  assert.equal(state.saved.provider, 'qwen');
  assert.equal(state.saved.language, 'assisted');
  assert.equal(state.saved.effects, false);
  state = teachingSettingsReducer(state, { type: 'save' });
  assert.equal(state.saved.provider, 'openai');
  assert.equal(state.saved.effects, false);
});

test('reopening discards unsaved edits without changing other preferences', () => {
  let state = teachingSettingsReducer(createTeachingSettings(), { type: 'change', value: { style: 'serious' } });
  state = teachingSettingsReducer(state, { type: 'save' });
  const edited = teachingSettingsReducer(state, { type: 'change', value: { language: 'english' } });
  assert.equal(edited.draft.style, 'serious');
  assert.equal(edited.draft.voice, 'female');
  assert.equal(teachingSettingsReducer(edited, { type: 'open' }).draft.language, 'assisted');
  assert.deepEqual(teachingSettingsReducer(state, { type: 'save' }).saved, state.saved);
});
