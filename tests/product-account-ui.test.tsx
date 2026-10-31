import React from 'react';
import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/login' });
for (const key of ['window', 'self', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'navigator']) {
  Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true });
}
const { render, screen, fireEvent, cleanup, waitFor } = await import('@testing-library/react');
const { AccountForm } = await import('../components/product/account-form.tsx');
const calls: { path: string; body?: Record<string, unknown> }[] = [];
type Handler = (path: string, body?: Record<string, unknown>) => Response | Promise<Response>;
let handler: Handler;
const success = (value = {}) => Response.json({ ok: true, ...value });
beforeEach(() => {
  calls.length = 0;
  handler = path => path.endsWith('/state') ? success({ user: null, flow: null }) : Response.json({ ok: false, error: { code: 'UNAVAILABLE', message: '账号服务暂不可用。' } }, { status: 503 });
  globalThis.fetch = async (input, init) => {
    const path = String(input), body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ path, body });
    return handler(path, body);
  };
});
afterEach(cleanup);
after(() => dom.window.close());
async function loaded() { await waitFor(() => assert(!screen.queryByText('正在检查账号…'))); }
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });

test('password login has semantic registration/recovery links and no review shortcuts', async () => {
  render(<AccountForm intent="login" />); await loaded();
  assert.equal(screen.getByRole('link', { name: '注册账号' }).getAttribute('href'), '/login?intent=register');
  assert.equal(screen.getByRole('link', { name: '忘记密码？' }).getAttribute('href'), '/login?intent=recover');
  assert.equal(screen.getByRole('link', { name: 'Teeko 首页' }).getAttribute('href'), '/');
  assert(!screen.queryByText(/模拟|示例邀请码|审阅|P0/));
});

test('password login uses the real endpoint and navigates only after server success', async () => {
  const destinations: string[] = [];
  handler = path => path.endsWith('/state') ? success({ user: null, flow: null }) : success({ next: '/courses' });
  render(<AccountForm intent="login" navigate={path => destinations.push(path)} />); await loaded();
  fill('邮箱', 'learner@example.com'); fill('密码', 'not-a-real-password');
  fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
  assert.equal(screen.getByLabelText('密码', { exact: true }).getAttribute('type'), 'text');
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  await waitFor(() => assert.deepEqual(destinations, ['/courses']));
  assert.deepEqual(calls.find(call => call.path.endsWith('/login'))?.body, { email: 'learner@example.com', password: 'not-a-real-password' });
  assert.equal(dom.window.localStorage.length, 0);
});

test('an unavailable invitation stays on the invite form and never fabricates an email step', async () => {
  render(<AccountForm intent="register" />); await loaded();
  fill('邀请码', 'TEEKO-TRY'); fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, '账号服务暂不可用。'));
  assert.deepEqual(calls.find(call => call.path.endsWith('/invitations/verify'))?.body, { code: 'TEEKO-TRY' });
  assert(!screen.queryByLabelText('邮箱')); assert(!screen.queryByText(/已发送|注册成功/));
});

test('registration verifies invite and email before passwords and sends explicit agreement', async () => {
  const destinations: string[] = [];
  handler = (path, body) => {
    if (path.endsWith('/state')) return success({ user: null, flow: null });
    if (path.endsWith('/invitations/verify')) return success({ next: '/login?intent=register' });
    if (path.endsWith('/code')) return success({ stage: 'code', retryAfter: 60 });
    if (path.endsWith('/verify')) return body?.code === '123456' ? success({ stage: 'password' }) : Response.json({ ok: false, error: { code: 'CODE_INVALID', message: '验证码不正确。' } }, { status: 400 });
    if (path.endsWith('/register')) return success({ next: '/onboarding' });
    throw new Error(path);
  };
  render(<AccountForm intent="register" navigate={path => destinations.push(path)} />); await loaded();
  fill('邀请码', 'PRIVATE-INVITE'); fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));
  await waitFor(() => assert(screen.getByLabelText('邮箱')));
  fill('邮箱', 'learner@example.com'); fireEvent.click(screen.getByRole('button', { name: '发送验证码' }));
  await waitFor(() => assert(screen.getByLabelText('验证码')));
  assert(!screen.queryByLabelText('密码', { exact: true }));
  assert.equal((screen.getByLabelText('验证码') as HTMLInputElement).value, '');
  fill('验证码', '000000'); fireEvent.click(screen.getByRole('button', { name: '验证邮箱' }));
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, '验证码不正确。'));
  fill('验证码', '123456'); fireEvent.click(screen.getByRole('button', { name: '验证邮箱' }));
  await waitFor(() => assert(screen.getByLabelText('密码', { exact: true })));
  fill('密码', 'new-password-123'); fill('确认密码', 'new-password-123');
  await waitFor(() => assert(screen.getByRole('button', { name: '完成注册' })));
  fireEvent.click(screen.getByRole('button', { name: '完成注册' }));
  await waitFor(() => assert(screen.getByRole('alert').textContent?.includes('用户协议')));
  await waitFor(() => assert(screen.getByRole('button', { name: '完成注册' })));
  fireEvent.click(screen.getByRole('checkbox', { name: /已阅读并同意/ }));
  fireEvent.click(screen.getByRole('button', { name: '完成注册' }));
  await waitFor(() => assert.deepEqual(destinations, ['/onboarding']));
  assert.deepEqual(calls.find(call => call.path.endsWith('/register'))?.body, { password: 'new-password-123', confirmation: 'new-password-123', agreed: true });
});

test('refresh resumes verified registration without exposing or storing a proof', async () => {
  handler = () => success({ user: null, flow: { purpose: 'register', stage: 'password', email: 'learner@example.com' } });
  render(<AccountForm intent="register" />); await loaded();
  assert(screen.getByLabelText('确认密码')); assert(!screen.queryByLabelText('验证码'));
  assert(screen.getByText('learner@example.com')); assert.equal(dom.window.localStorage.length, 0);
});

test('recovery uses reset purpose and completes without automatic login', async () => {
  const destinations: string[] = [];
  handler = path => path.endsWith('/state') ? success({ user: null, flow: null }) : path.endsWith('/code') ? success({ stage: 'code', retryAfter: 60 }) : path.endsWith('/verify') ? success({ stage: 'password' }) : success({ next: '/login' });
  render(<AccountForm intent="recover" navigate={path => destinations.push(path)} />); await loaded();
  fill('邮箱', 'learner@example.com'); fireEvent.click(screen.getByRole('button', { name: '发送验证码' }));
  await waitFor(() => assert(screen.getByLabelText('验证码')));
  fill('验证码', '123456'); fireEvent.click(screen.getByRole('button', { name: '验证邮箱' }));
  await waitFor(() => assert(screen.getByLabelText('确认密码')));
  fill('密码', 'replacement-123'); fill('确认密码', 'replacement-123');
  fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));
  await waitFor(() => assert.deepEqual(destinations, ['/login']));
  assert.deepEqual(calls.find(call => call.path.endsWith('/code'))?.body, { purpose: 'reset', email: 'learner@example.com' });
  assert(!calls.some(call => call.path.endsWith('/login')));
});

test('changing verified email cancels the old proof and returns registration to invitation', async () => {
  handler = path => path.endsWith('/state') ? success({ user: null, flow: { purpose: 'register', stage: 'password', email: 'learner@example.com' } }) : success();
  render(<AccountForm intent="register" />); await loaded();
  fireEvent.click(screen.getByRole('button', { name: '更换邮箱' }));
  await waitFor(() => assert(screen.getByLabelText('邀请码')));
  assert(calls.some(call => call.path.endsWith('/cancel'))); assert(!screen.queryByLabelText('确认密码'));
});

test('pending login ignores duplicate submissions and does not navigate after unmount', async () => {
  const destinations: string[] = [];
  let resolveLogin: ((response: Response) => void) | undefined;
  handler = path => path.endsWith('/state') ? success({ user: null, flow: null }) : new Promise<Response>(resolve => { resolveLogin = resolve; });
  const view = render(<AccountForm intent="login" navigate={path => destinations.push(path)} />); await loaded();
  fill('邮箱', 'learner@example.com'); fill('密码', 'not-a-real-password');
  const form = screen.getByRole('form'); fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => assert.equal(calls.filter(call => call.path.endsWith('/login')).length, 1));
  view.unmount(); resolveLogin!(success({ next: '/courses' }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(destinations, []);
});

test('failed account state can retry and recover without losing field validation', async () => {
  let unavailable = true;
  handler = () => unavailable ? Response.json({ ok: false, error: { code: 'UNAVAILABLE', message: '账号暂时无法连接。' } }, { status: 503 }) : success({ user: null, flow: null });
  render(<AccountForm intent="recover" />);
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, '账号暂时无法连接。'));
  unavailable = false; fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  await waitFor(() => assert(!screen.queryByRole('alert')));
  fireEvent.click(screen.getByRole('button', { name: '发送验证码' }));
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, '请输入有效的邮箱地址。'));
});
