import test from 'node:test';
import assert from 'node:assert/strict';
import { captureClassroomState, validateClassroomTaskResult } from '../lib/domain/classroom-context.ts';

const context = () => ({
  logicalSessionId: 'session-1',
  courseVersion: 'fruit:v1',
  connectionEpoch: 2,
  stateRevision: 10,
  pageId: 'page-1',
  activityId: 'activity-1',
});
const state = () => ({ status: 'active', context: context() });
const envelope = () => ({ context: context(), payload: { text: 'Consider the apple.', objectIds: ['apple'] } });

test('accepts a candidate only in the same active context without changing its data', () => {
  const current = state(), result = envelope();
  const verdict = validateClassroomTaskResult(current, result);
  assert.equal(verdict.accepted, true);
  if (!verdict.accepted) return;
  assert.deepEqual(verdict.candidate, result);
  assert.deepEqual(current, state());
  assert.deepEqual(result, envelope());
});

for (const [field, replacement, reason] of [
  ['logicalSessionId', 'session-2', 'session_mismatch'],
  ['courseVersion', 'fruit:v2', 'course_version_mismatch'],
  ['connectionEpoch', 3, 'connection_epoch_mismatch'],
  ['pageId', 'page-2', 'page_mismatch'],
  ['activityId', 'activity-2', 'activity_mismatch'],
] as const) {
  test(`rejects a late result after current ${field} changes`, () => {
    const current = state();
    Object.assign(current.context, { [field]: replacement });
    assert.deepEqual(validateClassroomTaskResult(current, envelope()), { accepted: false, reason });
  });
}

test('rejects a result from a connection epoch ahead of current', () => {
  const result = envelope();
  result.context.connectionEpoch++;
  assert.deepEqual(validateClassroomTaskResult(state(), result), { accepted: false, reason: 'connection_epoch_mismatch' });
});

for (const [revision, reason] of [[9, 'stale_revision'], [11, 'future_revision']] as const) {
  test(`rejects ${reason} even when page and activity still match`, () => {
    const result = envelope();
    result.context.stateRevision = revision;
    assert.deepEqual(validateClassroomTaskResult(state(), result), { accepted: false, reason });
  });
}

for (const status of ['created', 'preflight', 'paused', 'ending', 'ended']) {
  test(`rejects a matching result while classroom is ${status}`, () => {
    assert.deepEqual(validateClassroomTaskResult({ ...state(), status }, envelope()), { accepted: false, reason: 'not_active' });
  });
}

test('resuming active with an advanced revision rejects the pre-pause candidate', () => {
  const resultBeforePause = envelope();
  const resumed = state();
  resumed.context.stateRevision += 2;
  assert.deepEqual(validateClassroomTaskResult(resumed, resultBeforePause), { accepted: false, reason: 'stale_revision' });
});

test('resuming on a new connection rejects the old attempt even with the same activity', () => {
  const resultBeforeReconnect = envelope();
  const resumed = state();
  resumed.context.connectionEpoch++;
  resumed.context.stateRevision++;
  assert.deepEqual(validateClassroomTaskResult(resumed, resultBeforeReconnect), { accepted: false, reason: 'connection_epoch_mismatch' });
});

test('requires every scope field in both state and result', () => {
  for (const field of Object.keys(context())) {
    const incomplete: Record<string, unknown> = context();
    delete incomplete[field];
    assert.deepEqual(validateClassroomTaskResult({ ...state(), context: incomplete }, envelope()), { accepted: false, reason: 'invalid_state' });
    assert.deepEqual(validateClassroomTaskResult(state(), { ...envelope(), context: incomplete }), { accepted: false, reason: 'invalid_result' });
  }
});

for (const invalid of [null, undefined, 'active', [], {}, { ...state(), status: 'reconnecting' }, { ...state(), correct: true }]) {
  test(`rejects malformed current state ${JSON.stringify(invalid)}`, () => {
    assert.deepEqual(captureClassroomState(invalid), { ok: false, reason: 'invalid_state' });
    assert.deepEqual(validateClassroomTaskResult(invalid, envelope()), { accepted: false, reason: 'invalid_state' });
  });
}

for (const invalid of [null, undefined, 'result', [], {}, { payload: envelope().payload }, { context: context() }]) {
  test(`rejects malformed task envelope ${JSON.stringify(invalid)}`, () => {
    assert.deepEqual(validateClassroomTaskResult(state(), invalid), { accepted: false, reason: 'invalid_result' });
  });
}

for (const field of ['logicalSessionId', 'courseVersion', 'pageId', 'activityId'] as const) {
  test(`bounds and validates ${field} in state and result`, () => {
    for (const value of ['', ' ', ' id', 'id\n', 'x'.repeat(129)]) {
      const invalidContext = { ...context(), [field]: value };
      assert.deepEqual(validateClassroomTaskResult({ ...state(), context: invalidContext }, envelope()), { accepted: false, reason: 'invalid_state' });
      assert.deepEqual(validateClassroomTaskResult(state(), { ...envelope(), context: invalidContext }), { accepted: false, reason: 'invalid_result' });
    }
    const boundaryContext = { ...context(), [field]: 'x'.repeat(128) };
    assert.equal(validateClassroomTaskResult({ ...state(), context: boundaryContext }, { ...envelope(), context: boundaryContext }).accepted, true);
  });
}

for (const field of ['connectionEpoch', 'stateRevision'] as const) {
  test(`${field} accepts only nonnegative safe integers without coercion`, () => {
    for (const value of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
      const invalidContext = { ...context(), [field]: value };
      assert.deepEqual(validateClassroomTaskResult({ ...state(), context: invalidContext }, envelope()), { accepted: false, reason: 'invalid_state' });
      assert.deepEqual(validateClassroomTaskResult(state(), { ...envelope(), context: invalidContext }), { accepted: false, reason: 'invalid_result' });
    }
    for (const value of [0, Number.MAX_SAFE_INTEGER]) {
      const boundaryContext = { ...context(), [field]: value };
      assert.equal(validateClassroomTaskResult({ ...state(), context: boundaryContext }, { ...envelope(), context: boundaryContext }).accepted, true);
    }
  });
}

test('bounds candidate text, object count and object identifiers', () => {
  const valid = { ...envelope(), payload: { text: 'x'.repeat(2000), objectIds: Array.from({ length: 20 }, () => 'x'.repeat(128)) } };
  assert.equal(validateClassroomTaskResult(state(), valid).accepted, true);
  for (const payload of [
    { text: '', objectIds: [] },
    { text: 'x'.repeat(2001), objectIds: [] },
    { text: 'Consider it.', objectIds: Array.from({ length: 21 }, () => 'apple') },
    { text: 'Consider it.', objectIds: ['x'.repeat(129)] },
    { text: 'Consider it.', objectIds: [''] },
    { text: 'Consider it.', objectIds: ['apple\n'] },
    { text: 'Consider it.', objectIds: [42] },
    { text: 'Consider it.', objectIds: 'apple' },
  ]) {
    assert.deepEqual(validateClassroomTaskResult(state(), { ...envelope(), payload }), { accepted: false, reason: 'invalid_result' });
  }
  assert.equal(validateClassroomTaskResult(state(), { ...envelope(), payload: { text: 'A suggestion.', objectIds: [] } }).accepted, true);
});

for (const field of ['correct', 'usage', 'ended', 'unexpected']) {
  test(`rejects extra ${field} at every state and result object boundary`, () => {
    const extra = { [field]: true };
    for (const current of [{ ...state(), ...extra }, { ...state(), context: { ...context(), ...extra } }]) {
      assert.deepEqual(validateClassroomTaskResult(current, envelope()), { accepted: false, reason: 'invalid_state' });
    }
    for (const result of [
      { ...envelope(), ...extra },
      { ...envelope(), context: { ...context(), ...extra } },
      { ...envelope(), payload: { ...envelope().payload, ...extra } },
    ]) {
      assert.deepEqual(validateClassroomTaskResult(state(), result), { accepted: false, reason: 'invalid_result' });
    }
  });
}

test('captured snapshot cannot be retargeted by changing its original input or output', () => {
  const original = state();
  const capture = captureClassroomState(original);
  assert.equal(capture.ok, true);
  if (!capture.ok) return;
  original.context.activityId = 'activity-2';
  original.status = 'ended';
  assert.equal(capture.snapshot.status, 'active');
  assert.equal(capture.snapshot.context.activityId, 'activity-1');
  assert(Object.isFrozen(capture.snapshot));
  assert(Object.isFrozen(capture.snapshot.context));
  assert.throws(() => Object.assign(capture.snapshot.context, { activityId: 'activity-2' }), TypeError);
  assert.throws(() => Object.assign(capture.snapshot, { status: 'ended' }), TypeError);
  assert.deepEqual(validateClassroomTaskResult(capture.snapshot, { ...envelope(), context: { ...context(), activityId: 'activity-2' } }), { accepted: false, reason: 'activity_mismatch' });
  assert.deepEqual(validateClassroomTaskResult(original, envelope()), { accepted: false, reason: 'not_active' });
});

test('accepted candidate is a frozen copy, including context and payload array', () => {
  const input = envelope();
  const verdict = validateClassroomTaskResult(state(), input);
  assert.equal(verdict.accepted, true);
  if (!verdict.accepted) return;
  input.context.activityId = 'activity-2';
  input.payload.text = 'changed';
  input.payload.objectIds.push('pear');
  assert.deepEqual(verdict.candidate, envelope());
  assert(Object.isFrozen(verdict.candidate));
  assert(Object.isFrozen(verdict.candidate.context));
  assert(Object.isFrozen(verdict.candidate.payload));
  assert(Object.isFrozen(verdict.candidate.payload.objectIds));
  assert.throws(() => Object.assign(verdict.candidate.context, { activityId: 'activity-2' }), TypeError);
  assert.throws(() => Object.assign(verdict.candidate.payload, { text: 'changed' }), TypeError);
  assert.throws(() => (verdict.candidate.payload.objectIds as string[]).push('pear'), TypeError);
});

test('checks format before context scope and rejects nonactive state before mismatches', () => {
  assert.deepEqual(validateClassroomTaskResult(null, null), { accepted: false, reason: 'invalid_state' });
  assert.deepEqual(validateClassroomTaskResult({ ...state(), status: 'ended' }, null), { accepted: false, reason: 'invalid_result' });
  assert.deepEqual(validateClassroomTaskResult({ ...state(), status: 'ended' }, { ...envelope(), context: { ...context(), logicalSessionId: 'other' } }), { accepted: false, reason: 'not_active' });
});
