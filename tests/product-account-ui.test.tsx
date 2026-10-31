import React from 'react';
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/login' });
for (const key of ['window', 'self', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'navigator']) {
  Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true });
}
const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
const { AccountForm } = await import('../components/product/account-form.tsx');
afterEach(cleanup);
after(() => dom.window.close());

test('password login has semantic registration/recovery links and no review shortcuts', () => {
  render(<AccountForm intent="login" />);
  assert.equal(screen.getByRole('link', { name: '注册账号' }).getAttribute('href'), '/login?intent=register');
  assert.equal(screen.getByRole('link', { name: '忘记密码？' }).getAttribute('href'), '/login?intent=recover');
  assert.equal(screen.getByRole('link', { name: 'Teeko 首页' }).getAttribute('href'), '/');
  assert(!screen.queryByText(/模拟|示例邀请码|审阅|P0/));
});

test('valid local login shows unavailable without accepting the password or opening a classroom', () => {
  render(<AccountForm intent="login" />);
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'learner@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'not-a-real-password' } });
  fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
  assert.equal(screen.getByLabelText('密码').getAttribute('type'), 'text');
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  assert.equal(screen.getByRole('alert').textContent, '账号服务尚未开放，请稍后再试。');
  assert.equal(dom.window.location.pathname, '/login');
  assert(!screen.queryByText(/登录成功|开始上课/));
});

test('register cannot bypass the invitation using review codes and does not show a fake email step', () => {
  render(<AccountForm intent="register" />);
  assert(!screen.queryByLabelText('邮箱'));
  fireEvent.change(screen.getByLabelText('邀请码'), { target: { value: 'TEEKO-TRY' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));
  assert.equal(screen.getByRole('alert').textContent, '账号服务尚未开放，请稍后再试。');
  assert(!screen.queryByText(/验证码已发送|注册成功/));
});

test('recovery validates email then reports unavailable rather than claiming an email was sent', () => {
  render(<AccountForm intent="recover" />);
  fireEvent.click(screen.getByRole('button', { name: '发送验证码' }));
  assert.equal(screen.getByRole('alert').textContent, '请输入有效的邮箱地址。');
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'learner@example.com' } });
  assert(!screen.queryByRole('alert'));
  fireEvent.click(screen.getByRole('button', { name: '发送验证码' }));
  assert.equal(screen.getByRole('alert').textContent, '账号服务尚未开放，请稍后再试。');
  assert(!screen.queryByText(/已发送|已填入/));
});
