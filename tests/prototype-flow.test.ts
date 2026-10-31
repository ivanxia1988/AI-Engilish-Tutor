import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOTYPE_SCREENS, prototypeDestination, resumeLesson, cancelLessonEnd, restoreLessonConnection, resolvePrototypeScreen, type PrototypeScreenId } from '../lib/prototype-flow.ts';

test('prototype includes a public landing before the 26 application screens', () => {
  const ids = PROTOTYPE_SCREENS.map(screen => screen.id);
  assert.equal(ids.length, 27);
  assert.equal(new Set(ids).size, 27);
  assert.deepEqual(ids.slice(0, 2), ['00', '01']);
  assert.equal(resolvePrototypeScreen('00'), '00');
  assert.equal(resolvePrototypeScreen('01'), '01');
  for (let i = 1; i <= 29; i++) if (![22, 24, 26].includes(i)) assert(ids.includes(String(i).padStart(2, '0') as PrototypeScreenId));
  assert(!ids.includes('22'));
  assert(!ids.includes('24'));
  assert(!ids.includes('26'));
  assert.equal(ids[ids.indexOf('23') + 1], '25');
  assert.equal(ids[ids.indexOf('25') + 1], '27');
  assert.equal(resolvePrototypeScreen('22'), '12');
  assert.equal(resolvePrototypeScreen('24'), '03');
  assert.equal(resolvePrototypeScreen('26'), '27');
  assert.equal(resolvePrototypeScreen('99'), null);
});

test('landing calls to action always enter authentication in both review modes', () => {
  for (const mode of ['p0', 'full'] as const) assert.equal(prototypeDestination('landing-enter', mode), '01');
});

test('P0 onboarding, completion and failed reconnect return to its lesson picker', () => {
  assert.equal(prototypeDestination('profile-saved', 'p0'), '04');
  assert.equal(prototypeDestination('lesson-finished', 'p0'), '04');
  assert.equal(prototypeDestination('reconnect-failed', 'p0'), '04');
  assert.equal(prototypeDestination('checks-passed', 'p0', true), '17');
  assert.equal(prototypeDestination('checks-passed', 'p0', false), '06');
});

test('full review shows first-home then normal home without changing the original lesson', () => {
  assert.equal(prototypeDestination('profile-saved', 'full'), '16');
  assert.equal(prototypeDestination('lesson-finished', 'full'), '03');
  assert.equal(prototypeDestination('reconnect-failed', 'full'), '03');
  assert.equal(resumeLesson('09'), '09');
  assert.equal(resumeLesson('20'), '06');
  assert.equal(resumeLesson('18'), '06');
});

test('selecting a lesson preserves first-time permission and instruction steps in both modes', () => {
  for (const mode of ['p0', 'full'] as const) {
    assert.equal(prototypeDestination('lesson-selected', mode, true), '14');
    assert.equal(prototypeDestination('checks-passed', mode, true), '17');
    assert.equal(prototypeDestination('lesson-selected', mode, false), '05');
    assert.equal(prototypeDestination('checks-passed', mode, false), '06');
  }
});

test('cancelling end during reconnect keeps waiting instead of reviving the lesson', () => {
  assert.equal(cancelLessonEnd('20', '07'), '20');
  assert.equal(cancelLessonEnd('07', '07'), '07');
  assert.equal(cancelLessonEnd('18', '09'), '18');
  assert.equal(cancelLessonEnd('11', '09'), '11');
});

test('restoring the connection preserves a pre-existing pause', () => {
  assert.equal(restoreLessonConnection('11', '07'), '11');
  assert.equal(restoreLessonConnection('18', '07'), '18');
  assert.equal(restoreLessonConnection('07', '07'), '07');
});

test('every semantic destination is a declared prototype screen', () => {
  const ids = new Set(PROTOTYPE_SCREENS.map(screen => screen.id));
  for (const mode of ['p0', 'full'] as const) {
    for (const event of ['landing-enter', 'profile-saved', 'lesson-selected', 'lesson-finished', 'reconnect-failed', 'checks-passed'] as const) {
      assert(ids.has(prototypeDestination(event, mode)));
    }
  }
});
