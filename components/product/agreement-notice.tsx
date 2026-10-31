'use client';

import { useEffect, useRef } from 'react';

export function AgreementNotice({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="tk-agreement" ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose} aria-labelledby="tk-agreement-title">
    <h2 id="tk-agreement-title">用户协议</h2>
    <p>用户协议将在账号服务开放前公布。当前不会提交同意记录。</p>
    <button type="button" className="tk-submit" onClick={onClose} autoFocus>知道了</button>
  </dialog>;
}
