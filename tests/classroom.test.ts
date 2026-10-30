import test from "node:test";
import assert from "node:assert/strict";
import { lessonStats, matchesSpeech, normalizedPoint, recordAnswer, resolveSelection } from "../lib/classroom.ts";
import type { PageObject, Progress } from "../lib/types.ts";
const objects: PageObject[] = [
  { id: "apple", label: "apple", chinese: "苹果", box: { x: .1, y: .2, w: .2, h: .25 } },
  { id: "banana", label: "banana", chinese: "香蕉", box: { x: .55, y: .2, w: .2, h: .25 } },
];
test("normalizes coordinates independently of viewport size and clamps to page", () => {
  assert.deepEqual(normalizedPoint(250, 100, { left: 50, top: 20, width: 400, height: 200 }), { x: .5, y: .4 });
  assert.deepEqual(normalizedPoint(-20, 900, { left: 50, top: 20, width: 400, height: 200 }), { x: 0, y: 1 });
});
test("tap resolves visible object and never credits empty space", () => {
  assert.deepEqual(resolveSelection([{ x: .2, y: .3 }], objects), { status: "selected", ids: ["apple"] });
  assert.deepEqual(resolveSelection([{ x: .9, y: .8 }], objects), { status: "empty", ids: [] });
});
test("ellipse resolves intent in both drag directions", () => {
  const box = [{ x: .08, y: .15 }, { x: .33, y: .5 }];
  assert.deepEqual(resolveSelection(box, objects, "circle"), { status: "selected", ids: ["apple"] });
  assert.deepEqual(resolveSelection(box.toReversed(), objects, "circle"), { status: "selected", ids: ["apple"] });
});
test("a large circle around multiple objects asks for clarification", () => {
  assert.equal(resolveSelection([{ x: .01, y: .02 }, { x: .9, y: .7 }], objects, "circle").status, "ambiguous");
});
test("irregular closed polygon selects the object it encloses", () => {
  const polygon = [{x:.07,y:.16},{x:.2,y:.12},{x:.34,y:.19},{x:.37,y:.35},{x:.31,y:.49},{x:.2,y:.52},{x:.07,y:.44},{x:.04,y:.3},{x:.07,y:.16}];
  assert.deepEqual(resolveSelection(polygon, objects), { status: "selected", ids: ["apple"] });
});
test("an open slash across blank space is not a selection", () => {
  assert.equal(resolveSelection([{x:.02,y:.8},{x:.2,y:.7},{x:.4,y:.6},{x:.8,y:.8}], objects).status, "empty");
});
test("speech matching ignores punctuation but uses complete words", () => {
  assert(matchesSpeech("An APPLE!", "apple"));
  assert(matchesSpeech("I like apples!", "I like apples."));
  assert(!matchesSpeech("pineapple", "apple"));
  assert(!matchesSpeech("not apple", "apple"));
  assert(!matchesSpeech("I don't know apple", "apple"));
  assert(!matchesSpeech("", "apple"));
});
test("retries update a single record and never inflate independent answers", () => {
  let p: Progress = { bookId:"b",lessonId:"l",stepIndex:1,completed:false,answers:[],strokes:[],startedAt:"now",updatedAt:"now" };
  p = recordAnswer(p, "s1", false, "banana", false);
  p = recordAnswer(p, "s1", true, "apple", false);
  p = recordAnswer(p, "s2", true, "cat", true);
  assert.equal(p.answers.length, 2); assert.equal(p.answers[0].attempts, 2);
  assert.deepEqual(lessonStats(p), { answered:2, independent:0, practiced:2 });
});
