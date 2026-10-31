'use client';

import { useEffect, useRef, useState } from 'react';
import { MarketingLanding } from '../prototype/marketing-landing';
import { invitationSubmissionError } from './account-state';
import { accountRequest, destination, errorMessage, navigateProduct, type ProductDestination } from './account-request';
import { AgreementNotice } from './agreement-notice';

export function ProductLanding({ navigate = navigateProduct }: { navigate?: (path: ProductDestination) => void }) {
  const [code, setCode] = useState(''), [error, setError] = useState(''), [agreement, setAgreement] = useState(false), [busy, setBusy] = useState(false);
  const locked = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function verify() {
    if (locked.current) return;
    const validation = invitationSubmissionError(code);
    if (validation) { setError(validation); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await accountRequest('/invitations/verify', destination, { body: { code: code.trim() } });
      if (mounted.current) { setCode(''); navigate(result.next); }
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="tk-product tk-product-landing">
    <MarketingLanding invitation={{ code, error, busy }} onInvitationChange={value => { if (!locked.current) { setCode(value); setError(''); } }} onInvitationSubmit={() => { void verify(); }} loginHref="/login" onAgreement={() => setAgreement(true)} />
    {agreement && <AgreementNotice onClose={() => setAgreement(false)} />}
  </div>;
}
