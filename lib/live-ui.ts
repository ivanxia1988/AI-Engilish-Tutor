import type { LiveContext } from './live-protocol';

/** Only explicit requests to operate the page; statements, negations and vocabulary questions never act. */
export function requestsDrawing(text: string) {
  if (/\b(don'?t|do not|never|stop|cancel|not yet|wait)\b|不要|别圈|取消|等等|停一下/i.test(text)) return false;
  if (/\b(meaning|means|mean|translate|pronounce)\b|什么意思|怎么读|翻译/i.test(text)) return false;
  return /^(?:(?:please|can you|could you|would you|will you|i (?:want|need) you to|help me|okay|ok|now)[\s,，:：]*)*(?:circle|highlight|mark|point (?:at|to)|draw (?:me )?(?:a )?circle around)\b/i.test(text.trim()) || /^(?:老师|小叶|请|你能|可以|能不能|帮我|麻烦|给我|把|这个|请你|一下|\s|，|,)*(?:把.{0,40}圈|圈(?:出|一下|起来|住)|标[出记]|在.{0,40}画(?:个|一?个)?圈)/u.test(text.trim());
}
export function requestedObjects(text: string, context: LiveContext): string[] {
  if (!requestsDrawing(text)) return [];
  const normalized = text.toLowerCase();
  const ids = context.objects.filter(o => {
    const en = o.label.trim().toLowerCase(), zh = o.chinese.trim();
    const words: string[] = normalized.match(/[\p{L}\p{N}]+/gu) || [];
    return (en && (words.includes(en) || (en.includes(' ') && normalized.includes(en)))) || (zh && text.includes(zh));
  }).map(o => o.id);
  // Multiple matching objects need backend clarification, unless explicitly requested together.
  return ids.length === 1 || (ids.length <= 5 && /\band\b|和|还有|以及/i.test(text)) ? ids : [];
}
export function describeUI(context: LiveContext, previous?: LiveContext) {
  const names = (ids: string[]) => ids.map(id => context.objects.find(o => o.id === id)?.label || id).join(', ') || 'none';
  const a = context.annotations;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const facts: string[] = [];
  if (!previous || previous.contextKey !== context.contextKey || previous.step.english !== context.step.english) facts.push(`Classroom contextKey: ${context.contextKey}. Current task: ${context.step.english}`);
  if (!previous || !same(previous.selectedIds, context.selectedIds) || previous.answered !== context.answered) facts.push(`Learner selection now: ${names(context.selectedIds)}. Application-confirmed task correctness: ${context.answered}.`);
  if (!previous || previous.age !== context.age) facts.push(`Learner age for teaching pace: ${context.age}.`);
  if (!previous || !same(previous.objects, context.objects)) for (let i = 0; i < context.objects.length; i += 3) facts.push(`Known current page objects: ${context.objects.slice(i, i + 3).map(o => `${o.id} = ${o.label.slice(0,40)} (${o.chinese.slice(0,20)})`).join('; ')}.`);
  if (a && (!previous || !same(previous.annotations, a))) {
    facts.push(`Annotation revision ${a.revision}; latest learner operation: ${a.lastAction}; ${a.markCount} learner marks remain. Teacher circles currently around: ${names(a.teacherObjectIds)}.`);
    const last = a.marks.at(-1);
    if (last && (!previous || previous.annotations?.revision !== a.revision)) facts.push(`Latest remaining learner mark: ${last.color} ${last.tool}, around/touching ${names(last.objectIds)}; normalized bounds ${JSON.stringify(last.box)}. Unknown marks require page inspection.`);
    if (a.markCount === 0) facts.push('No learner marks remain on this task. Do not refer to old marks as still present.');
  }
  return facts;
}
