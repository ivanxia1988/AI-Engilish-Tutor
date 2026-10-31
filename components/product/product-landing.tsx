'use client';

import { useState } from 'react';
import { MarketingLanding } from '../prototype/marketing-landing';
import { invitationSubmissionError } from './account-state';
import { AgreementNotice } from './agreement-notice';

export function ProductLanding() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [agreement, setAgreement] = useState(false);
  return <div className="tk-product tk-product-landing">
    <MarketingLanding invitation={{ code, error }} onInvitationChange={value => { setCode(value); setError(''); }} onInvitationSubmit={() => setError(invitationSubmissionError(code))} loginHref="/login" onAgreement={() => setAgreement(true)} />
    {agreement && <AgreementNotice onClose={() => setAgreement(false)} />}
  </div>;
}
