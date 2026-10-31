import React, { useState } from 'react';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'self', 'document', 'HTMLElement', 'HTMLDialogElement', 'Node', 'Event', 'KeyboardEvent', 'navigator']) Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
const { AgreementNotice } = await import('../components/product/agreement-notice.tsx');
after(() => { cleanup(); dom.window.close(); });
test('Escape closes the controlled agreement dialog from its focused button', () => {
  function Harness() { const [open, setOpen] = useState(true); return open ? <AgreementNotice onClose={() => setOpen(false)} /> : <span>Closed</span>; }
  render(<Harness />);
  const button = screen.getByRole('button', { name: '知道了' }); button.focus();
  fireEvent.keyDown(button, { key: 'Escape' });
  assert.equal(screen.queryByRole('dialog'), null);
  assert(screen.getByText('Closed'));
});
