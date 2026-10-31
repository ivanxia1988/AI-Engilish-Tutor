import React, { useState } from 'react';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { VOICE_PROVIDERS, voiceProvider, type VoiceProviderId, type VoiceProviderStatus } from '../lib/voice-provider.ts';
import { defaultSettings } from '../lib/types.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'SVGElement', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'navigator']) Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });
dom.window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
Object.defineProperty(dom.window, 'speechSynthesis', { value: { cancel() {}, getVoices() { return []; }, speak() {} } });
Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { value: class { constructor(public text: string) {} }, configurable: true });
const { render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const { VoiceProviderPicker, resolvedVoiceStatuses } = await import('../components/voice-provider-picker.tsx');
const { default: Classroom } = await import('../components/legacy-classroom.tsx');
const { storage } = await import('../lib/storage.ts');

const statuses: VoiceProviderStatus[] = [
  { id: 'openai', name: VOICE_PROVIDERS.openai.name, transport: 'webrtc_direct', configured: true, model: 'gpt-live-1', missing: [] },
  { id: 'qwen', name: VOICE_PROVIDERS.qwen.name, transport: 'webrtc_direct', configured: false, model: 'qwen3.8-omni-flash-realtime', missing: ['DASHSCOPE_API_KEY', 'DASHSCOPE_WORKSPACE_ID'] },
  { id: 'doubao', name: VOICE_PROVIDERS.doubao.name, transport: 'websocket_relay', configured: false, model: '1.2.6.1', missing: ['VOLCENGINE_VOICE_API_KEY'] },
  { id: 'glm', name: VOICE_PROVIDERS.glm.name, transport: 'websocket_relay', configured: false, model: 'glm-realtime-flash', missing: ['ZHIPU_API_KEY'] },
];
beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
  globalThis.fetch = async path => String(path).includes('/api/network-check') ? Response.json({ ok: true, kind: 'littleleaf-network-probe' }) : Response.json({ configured: true, keyConfigured: true, liveReady: true, signedIn: true, voiceProviders: statuses });
});
afterEach(() => cleanup());

test('legacy status only enables the OpenAI fallback and old settings default to it', () => {
  const legacy = resolvedVoiceStatuses(undefined, true);
  assert.equal(legacy.find(value => value.id === 'openai')?.configured, true);
  assert(legacy.filter(value => value.id !== 'openai').every(value => !value.configured));
  assert(resolvedVoiceStatuses([], true).every(value => !value.configured));
  assert.equal(defaultSettings.voiceProvider, 'openai');
  assert.equal(voiceProvider(undefined), 'openai'); assert.equal(voiceProvider('not-a-provider'), 'openai');
});

test('all four services can be selected without credentials and configuration names remain inside help', () => {
  const selected: VoiceProviderId[] = [];
  function Harness() { const [value, setValue] = useState<VoiceProviderId>('openai'); return <VoiceProviderPicker value={value} statuses={statuses} onChange={next => { selected.push(next); setValue(next); }} />; }
  render(<Harness />);
  assert.equal(screen.getAllByRole('option').length, 4);
  const select = screen.getByRole('combobox', { name: '实时语音服务' });
  fireEvent.change(select, { target: { value: 'qwen' } });
  assert.deepEqual(selected, ['qwen']);
  assert(screen.getByText('待配置，尚未实测'));
  assert(screen.getByText('浏览器 WebRTC 直连'));
  const details = document.querySelector('details')!;
  assert.equal(details.open, false); assert(details.textContent?.includes('DASHSCOPE_API_KEY'));
  assert.equal(document.querySelectorAll('input').length, 0);
  fireEvent.change(select, { target: { value: 'doubao' } });
  assert(screen.getByText('网站后端 WebSocket 转发'));
  assert(screen.getByText(/不代表国内端到端线路/));
});

test('provider selection remains locked during a connection even on a synthetic change event', () => {
  const changes: VoiceProviderId[] = [];
  const app = render(<VoiceProviderPicker value="openai" statuses={statuses} locked onChange={value => changes.push(value)} />);
  const select = screen.getByRole('combobox', { name: '实时语音服务' });
  assert(select.hasAttribute('disabled'));
  fireEvent.change(select, { target: { value: 'qwen' } });
  assert.equal(changes.length, 0); assert(screen.getByText('请先结束实时课堂，再切换语音服务。'));
  app.rerender(<VoiceProviderPicker value="openai" statuses={statuses} onChange={value => changes.push(value)} />);
  fireEvent.change(screen.getByRole('combobox', { name: '实时语音服务' }), { target: { value: 'glm' } });
  assert.deepEqual(changes, ['glm']);
});

test('a saved missing provider cannot start a classroom using another provider credentials', async () => {
  await storage.saveSettings({ ...defaultSettings, consent: true, voice: false, voiceProvider: 'qwen' });
  let microphoneCalls = 0;
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => { microphoneCalls++; throw new Error('not expected'); } }, configurable: true });
  render(<Classroom />);
  await waitFor(() => assert(!screen.queryByText('正在打开小课堂…')));
  await waitFor(() => assert.equal((screen.getByRole('combobox', { name: '实时语音服务' }) as unknown as HTMLSelectElement).value, 'qwen'));
  assert(screen.getByRole('button', { name: '开始实时课堂' }).hasAttribute('disabled'));
  assert(screen.getByText('待配置，尚未实测'));
  fireEvent.click(screen.getByRole('button', { name: '进入沉浸课堂' }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(microphoneCalls, 0);
});

test('selecting a configured provider enables manual start without starting a paid session', async () => {
  const calls: string[] = [];
  globalThis.fetch = async path => {
    calls.push(String(path));
    return String(path).includes('/api/network-check') ? Response.json({ ok: true, kind: 'littleleaf-network-probe' }) : Response.json({ configured: true, keyConfigured: true, liveReady: true, signedIn: true, voiceProviders: statuses.map(value => value.id === 'qwen' ? { ...value, configured: true, missing: [] } : value) });
  };
  await storage.saveSettings({ ...defaultSettings, consent: true, voice: false });
  render(<Classroom />);
  await waitFor(() => assert(!screen.queryByText('正在打开小课堂…')));
  fireEvent.change(screen.getByRole('combobox', { name: '实时语音服务' }), { target: { value: 'qwen' } });
  await waitFor(() => assert(!screen.getByRole('button', { name: '开始实时课堂' }).hasAttribute('disabled')));
  fireEvent.click(screen.getByRole('button', { name: '进入沉浸课堂' }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert(!calls.some(path => /\/api\/(?:live|voice)\/(?:session|connect)/.test(path)));
  await waitFor(async () => assert.equal((await storage.settings())?.voiceProvider, 'qwen'));
});

test('old servers without a provider list preserve manually started OpenAI availability', async () => {
  globalThis.fetch = async path => String(path).includes('/api/network-check') ? Response.json({ ok: true, kind: 'littleleaf-network-probe' }) : Response.json({ configured: true, keyConfigured: true, liveReady: true, signedIn: true });
  render(<Classroom />);
  await waitFor(() => assert(!screen.queryByText('正在打开小课堂…')));
  await waitFor(() => assert(!screen.getByRole('button', { name: '开始实时课堂' }).hasAttribute('disabled')));
  fireEvent.change(screen.getByRole('combobox', { name: '实时语音服务' }), { target: { value: 'glm' } });
  assert(screen.getByRole('button', { name: '开始实时课堂' }).hasAttribute('disabled'));
});
