import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoBook } from '../lib/demo.ts';
import { matchesSpeech } from '../lib/classroom.ts';

test('demo description tasks accept meaningful sentences without requiring isolated-word repetition', () => {
  const book = createDemoBook();
  for (const [index, lesson] of book.lessons.entries()) {
    for (const step of lesson.steps.filter(s => s.kind === 'speak' && !s.id.endsWith('sentence'))) {
      const word = step.expected!;
      const sentence = index === 2 ? `The color is ${word}.` : `${index === 1 ? 'I see' : 'It is'} ${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}.`;
      assert(matchesSpeech(sentence, word), `${step.id} must accept a sentence matching its objective`);
      assert(!matchesSpeech('I do not know.', word), `${step.id} must not accept an unrelated answer`);
      assert.equal((step.english.match(/[?？]/g) || []).length, 0, 'one clear descriptive action is enough');
    }
  }
});
