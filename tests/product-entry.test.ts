import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('public root selects the product landing instead of an authenticated classroom or review player', () => {
  const entry = source('app/page.tsx');
  assert.match(entry, /ProductLanding/);
  assert.doesNotMatch(entry, /ClassroomApp|useLiveClassroom|Prototype/);
});

test('shared landing does not import local invitation accounts or fixed demo verification', () => {
  const landing = source('components/prototype/marketing-landing.tsx');
  assert.doesNotMatch(landing, /prototype-auth|verifyPrototypeInvitation|TEEKO-TRY/);
  assert.match(landing, /onInvitationSubmit/);
});
