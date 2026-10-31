import test from 'node:test';
import assert from 'node:assert/strict';
import { endPresentation, participantConnection, shouldProtectLessonExit, bindLessonExitProtection } from '../lib/prototype-session.ts';

test('only a voluntary mid-lesson end can be cancelled to continue learning', () => {
  assert.equal(endPresentation('manual').canResume, true);
  for (const reason of ['content', 'time', 'session-limit', 'daily-limit'] as const) {
    assert.equal(endPresentation(reason).canResume, false);
  }
  assert.notEqual(endPresentation('content').title, endPresentation('time').title);
  assert.notEqual(endPresentation('session-limit').title, endPresentation('daily-limit').title);
});

test('participant links remain independent and unknown is never reported as good', () => {
  assert.equal(participantConnection('teacher', 'good', 'disconnected', true), 'good');
  assert.equal(participantConnection('student', 'good', 'disconnected', true), 'disconnected');
  assert.equal(participantConnection('teacher', 'unknown', 'good', false), 'unknown');
  assert.equal(participantConnection('teacher', 'good', 'good', true), 'disconnected');
  assert.equal(participantConnection('student', 'good', 'good', true), 'good');
});

test('exit protection only applies while a lesson has not ended', () => {
  for (const screen of ['06', '07', '08', '09', '10', '11', '18', '20', '21']) {
    assert.equal(shouldProtectLessonExit(screen, 'manual'), true);
  }
  assert.equal(shouldProtectLessonExit('19', 'manual'), true);
  for (const reason of ['content', 'time', 'session-limit', 'daily-limit'] as const) {
    assert.equal(shouldProtectLessonExit('19', reason), false);
  }
  for (const screen of ['01', '04', '05', '12', '13', '25', '27', '28']) {
    assert.equal(shouldProtectLessonExit(screen, 'manual'), false);
  }
});

test('unload protection prevents leaving and is removed after cleanup', () => {
  const target = new EventTarget();
  const makeEvent = () => {
    const event = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(event, 'returnValue', { value: undefined, writable: true });
    return event;
  };
  const cleanup = bindLessonExitProtection(target);
  const active = makeEvent();
  target.dispatchEvent(active);
  assert.equal(active.defaultPrevented, true);
  assert.equal(active.returnValue, '');
  cleanup();
  const ended = makeEvent();
  target.dispatchEvent(ended);
  assert.equal(ended.defaultPrevented, false);
});
