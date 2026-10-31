'use client';

import { useEffect, useRef } from 'react';
import { ACCOUNT_TERMS, ACCOUNT_TERMS_VERSION } from '../../lib/account-terms';

export function AgreementNotice({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="tk-agreement" ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose} aria-labelledby="tk-agreement-title">
    <h2 id="tk-agreement-title">用户协议</h2>
    <p>试用版 · {ACCOUNT_TERMS_VERSION}</p>
    <div className="tk-agreement-copy">{ACCOUNT_TERMS.map(section => <section key={section.title}><h3>{section.title}</h3><p>{section.text}</p></section>)}</div>
    <button type="button" className="tk-submit" onClick={onClose} autoFocus>知道了</button>
  </dialog>;
}
