import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteraction, interactionReducer, selectionForMark } from '../lib/prototype-interactions.ts';
import type { PageObject } from '../lib/types.ts';

test('incorrect choices can be retried, but a solved task only rewards once', () => {
  const wrong = interactionReducer(createInteraction(), { type: 'answer', ids: ['museum'] });
  assert.equal(wrong.status, 'retry');
  assert.equal(wrong.awardId, 0);
  assert.equal(wrong.assisted, true);
  assert.equal(wrong.highlighted, false);
  const correct = interactionReducer(wrong, { type: 'answer', ids: ['telescope'] });
  assert.equal(correct.status, 'correct');
  assert.equal(correct.awardId, 1);
  assert.equal(correct.assisted, true);
  assert.equal(interactionReducer(correct, { type: 'answer', ids: ['telescope'] }), correct);
  assert.equal(interactionReducer(correct, { type: 'answer', ids: ['museum'] }), correct);
});

test('empty or ambiguous selection asks for clarification without a reward', () => {
  for (const ids of [[], ['museum', 'telescope'], ['unknown']]) {
    const state = interactionReducer(createInteraction(), { type: 'answer', ids });
    assert.equal(state.status, 'unclear');
    assert.equal(state.awardId, 0);
  }
  assert.equal(interactionReducer(createInteraction(), { type: 'answer', ids: ['telescope', 'telescope'] }).status, 'correct');
});

test('a hint remains associated with the answer and the next question starts clean', () => {
  let state = interactionReducer(createInteraction(), { type: 'hint' });
  state = interactionReducer(state, { type: 'answer', ids: ['telescope'] });
  assert.equal(state.assisted, true);
  assert.equal(state.highlighted, true);
  assert.equal(interactionReducer(interactionReducer(createInteraction(), { type: 'answer', ids: ['museum'] }), { type: 'hint' }).selected, null);
  const next = interactionReducer(state, { type: 'next' });
  assert.equal(next.taskIndex, 1);
  assert.equal(next.status, 'idle');
  assert.equal(next.selected, null);
  assert.equal(next.assisted, false);
  assert.equal(next.awardId, state.awardId);
});

test('speech encouragement is separate from answer correctness', () => {
  const wrong = interactionReducer(createInteraction(), { type: 'answer', ids: ['museum'] });
  const praise = interactionReducer(wrong, { type: 'praise' });
  assert.equal(praise.status, 'retry');
  assert.equal(praise.awardKind, 'speech');
  assert.equal(praise.awardId, 1);
  assert.equal(interactionReducer(praise, { type: 'reset' }).status, 'idle');
});

const objects: PageObject[] = [
  { id: 'museum', label: 'museum', chinese: '博物馆', box: { x: .1, y: .1, w: .2, h: .2 } },
  { id: 'telescope', label: 'telescope', chinese: '望远镜', box: { x: .6, y: .1, w: .2, h: .2 } },
];
test('circle gestures resolve actual objects while free pen strokes remain annotations', () => {
  assert.deepEqual(selectionForMark({ id: 'a', tool: 'circle', color: '#000', points: [{ x: .55, y: .05 }, { x: .85, y: .35 }] }, objects), ['telescope']);
  assert.deepEqual(selectionForMark({ id: 'b', tool: 'circle', color: '#000', points: [{ x: .4, y: .5 }, { x: .6, y: .7 }] }, objects), []);
  assert.equal(selectionForMark({ id: 'c', tool: 'pen', color: '#000', points: [{ x: .1, y: .1 }, { x: .9, y: .1 }] }, objects), null);
});

test('one freehand pen can circle an answer without a separate circle tool', () => {
  const points = Array.from({ length: 25 }, (_, i) => ({ x: .7 + .16 * Math.cos(i * Math.PI / 12), y: .2 + .16 * Math.sin(i * Math.PI / 12) }));
  assert.deepEqual(selectionForMark({ id: 'freehand', tool: 'pen', color: '#c2602a', points }, objects), ['telescope']);
  assert.equal(selectionForMark({ id: 'open', tool: 'pen', color: '#c2602a', points: points.slice(0, 12) }, objects), null);
});
