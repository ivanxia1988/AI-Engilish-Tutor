import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoBook } from '../lib/demo.ts';
import { requestedObjects, requestsDrawing, describeUI } from '../lib/live-ui.ts';
import type { LiveContext } from '../lib/live-protocol.ts';
const book = createDemoBook();
const context: LiveContext = { contextKey: 'classroom:apple', lessonTitle: 'Fruit', age: 7, step: book.lessons[0].steps[1], objects: book.pages[0].objects, selectedIds: [], answered: false };
test('explicit English and Chinese circle requests resolve known objects', () => {
  for (const text of ['circle the apple', 'Can you circle this apple?', 'Please draw a circle around the apple.', '帮我圈出苹果', '请你把苹果圈起来']) assert.deepEqual(requestedObjects(text, context), ['0-apple'], text);
});
test('negations, incomplete words, statements and translation questions never draw', () => {
  for (const text of ['do not circle the apple', 'please circle the app', 'I circled the apple', 'what does circle the apple mean?', '不要圈苹果', '圈出苹果是什么意思']) assert.deepEqual(requestedObjects(text, context), [], text);
  assert(!requestsDrawing('I can see an apple.'));
});
test('ambiguous labels require clarification and never pick an arbitrary object', () => {
  const duplicate = { ...context, objects: [...context.objects, { ...context.objects[0], id: 'second-apple', label: 'apple', chinese: '苹果' }] };
  assert.deepEqual(requestedObjects('circle the apple', duplicate), []);
});
test('UI facts explicitly include unknown marks, undo, clear and teacher circles', () => {
  const marked = { ...context, annotations: { revision: 4, lastAction: 'draw' as const, markCount: 1, teacherObjectIds: ['0-apple'], marks: [{ id: 'stroke', tool: 'circle' as const, color: '#718d65', box: { x: .02, y: .01, w: .1, h: .1 }, objectIds: [] }] } };
  const description = describeUI(marked).join(' ');
  assert(description.includes('1 learner marks'));assert(description.includes('Teacher circles currently around: apple'));assert(description.includes('#718d65 circle'));assert(description.includes('Unknown marks require'));
  const cleared = describeUI({ ...marked, annotations: { ...marked.annotations, revision: 5, lastAction: 'clear', markCount: 0, marks: [], teacherObjectIds: [] } }).join(' ');
  assert(cleared.includes('No learner marks remain'));assert(cleared.includes('latest learner operation: clear'));
});
