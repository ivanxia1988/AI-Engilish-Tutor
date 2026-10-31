import test from 'node:test';
import assert from 'node:assert/strict';
import { markNearPoint, type PrototypeMark } from '../lib/prototype-annotations.ts';

test('eraser hits a pen segment between samples and ignores distant marks', () => {
  const mark: PrototypeMark = { id: 'a', tool: 'pen', color: '#e07a3f', points: [{ x: .1, y: .1 }, { x: .9, y: .9 }] };
  assert.equal(markNearPoint(mark, { x: .5, y: .5 }, .02), true);
  assert.equal(markNearPoint(mark, { x: .1, y: .9 }, .02), false);
});

test('ellipse hit testing handles reverse dragging without erasing an empty centre', () => {
  const mark: PrototypeMark = { id: 'b', tool: 'circle', color: '#e07a3f', points: [{ x: .8, y: .7 }, { x: .2, y: .3 }] };
  assert.equal(markNearPoint(mark, { x: .8, y: .5 }, .02), true);
  assert.equal(markNearPoint(mark, { x: .5, y: .5 }, .02), false);
  assert.equal(markNearPoint(mark, { x: .5, y: .7 }, .02), true);
});

test('eraser tolerance stays in pixels around a wide ellipse', () => {
  const mark: PrototypeMark = { id: 'c', tool: 'circle', color: '#e07a3f', points: [{ x: .1, y: .45 }, { x: .9, y: .55 }] };
  assert.equal(markNearPoint(mark, { x: .96, y: .5 }, 12, { x: 800, y: 500 }), false);
  assert.equal(markNearPoint(mark, { x: .91, y: .5 }, 12, { x: 800, y: 500 }), true);
});
