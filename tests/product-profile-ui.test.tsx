import React from 'react';
import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/onboarding' });
for (const key of ['window', 'self', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'navigator']) Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true });
const { render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const { OnboardingForm } = await import('../components/product/onboarding-form.tsx');
const { Courses } = await import('../components/product/courses.tsx');
const calls: { path: string; method?: string; body?: unknown }[] = [];
beforeEach(() => { calls.length = 0; globalThis.fetch = async (input, init) => { calls.push({ path: String(input), method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }); return Response.json({ ok: true, profile: null }); }; });
afterEach(cleanup); after(() => dom.window.close());

test('profile saves concrete single choices to the current account and continues only after success', async () => {
  const destinations: string[] = [];
  globalThis.fetch = async (input, init) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path: String(input), method: init?.method, body });
    return Response.json({ ok: true, profile: body ?? null });
  };
  render(<OnboardingForm navigate={path => destinations.push(path)} />);
  await waitFor(() => assert(!screen.queryByText('正在读取档案…')));
  assert.equal(screen.queryByRole('combobox'), null);
  fireEvent.change(screen.getByLabelText('孩子的称呼'), { target: { value: 'Mia' } });
  fireEvent.click(screen.getByRole('radio', { name: '8–9 岁' }));
  fireEvent.click(screen.getByRole('radio', { name: /能说简单句/ }));
  fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
  await waitFor(() => assert.deepEqual(destinations, ['/courses']));
  assert.deepEqual(calls.find(call => call.method === 'PATCH')?.body, { name: 'Mia', ageRange: '8–9', level: 'sentences' });
  assert(!JSON.stringify(calls).includes('accountId'));
});

test('profile refresh reads saved values and service failures do not claim saved', async () => {
  globalThis.fetch = async (_input, init) => init?.method === 'PATCH' ? Response.json({ ok: false, error: { code: 'UNAVAILABLE', message: '档案暂时无法保存。' } }, { status: 503 }) : Response.json({ ok: true, profile: { name: 'Mia', ageRange: '12–13', level: 'conversation' } });
  render(<OnboardingForm />);
  await waitFor(() => assert.equal((screen.getByLabelText('孩子的称呼') as HTMLInputElement).value, 'Mia'));
  assert.equal((screen.getByRole('radio', { name: '12–13 岁' }) as HTMLInputElement).checked, true);
  fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, '档案暂时无法保存。'));
});

test('an empty real course list shows no mock learning records and logout uses the real endpoint', async () => {
  const destinations: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ path: String(input), method: init?.method });
    return Response.json(String(input).endsWith('/courses') ? { ok: true, courses: [] } : { ok: true, next: '/' });
  };
  render(<Courses navigate={path => destinations.push(path)} />);
  await waitFor(() => assert(screen.getByText('课程准备中')));
  assert(!screen.queryByText(/Weekend plans|42|24 次|最近的课/));
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
  await waitFor(() => assert.deepEqual(destinations, ['/']));
  assert(calls.some(call => call.path === '/api/v1/auth/logout' && call.method === 'POST'));
});
