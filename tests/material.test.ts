import test from "node:test";
import assert from "node:assert/strict";
import { createDemoBook } from "../lib/demo.ts";
import { validateAnalysis } from "../lib/validation.ts";
import { makeManualBook } from "../lib/upload.ts";
test("all demo curriculum references and object coordinates are valid", () => {
  const b = createDemoBook(); const result = validateAnalysis(b, b.pages.map(p => p.id));
  assert.equal(result.lessons.length, 3);
  assert.equal(b.lessons.reduce((s,l) => s + l.steps.filter(t => t.kind !== "listen").length, 0), 21);
});
test("rejects hallucinated pages, nonexistent targets, duplicate IDs and invalid regions", () => {
  const original = createDemoBook();
  const mutations = [
    (b: typeof original) => { b.lessons[0].steps[0].pageId = "invisible"; },
    (b: typeof original) => { b.lessons[0].steps[1].targetId = "missing-apple"; },
    (b: typeof original) => { b.lessons[1].id = b.lessons[0].id; },
    (b: typeof original) => { b.pages[0].objects[0].box.x = .99; },
    (b: typeof original) => { b.pages[1].objects[0].id = b.pages[0].objects[0].id; },
    (b: typeof original) => { b.lessons[0].steps[2].expected = null; },
    (b: typeof original) => { b.pages[1].id = b.pages[0].id; },
  ];
  for (const mutate of mutations) { const b = structuredClone(original); mutate(b); assert.throws(() => validateAnalysis(b, original.pages.map(p => p.id))); }
});
test("manual preparation builds actionable exercises from actual marked objects", () => {
  const page = createDemoBook().pages[0], b = makeManualBook("我的水果书", [page]);
  assert.equal(b.source, "manual"); assert.equal(b.lessons[0].steps.length, 7);
  validateAnalysis(b, [page.id]);
  assert(b.lessons[0].steps.some(s => s.expected === "strawberry"));
});
