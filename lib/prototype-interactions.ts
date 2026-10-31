import { pointsBox, resolveSelection } from './classroom.ts';
import type { PrototypeMark } from './prototype-annotations.ts';
import type { PageObject } from './types.ts';

export const INTERACTION_TASKS = [
  { target: 'telescope', prompt: '找出望远镜', english: 'Find the telescope.', hint: '它可以帮我们看清远处的星星。', reply: 'Yes! That’s a telescope.' },
  { target: 'museum', prompt: '找出博物馆', english: 'Find the museum.', hint: '里面有展览，也能看到许多有趣的东西。', reply: 'You found the museum!' },
  { target: 'cinema', prompt: '找出电影院', english: 'Find the cinema.', hint: '我们在这里看电影。', reply: 'That’s right! The cinema.' },
] as const;
const ANSWERS = new Set(['museum', 'telescope', 'cinema', 'bookstore']);
export interface InteractionState {
  taskIndex: number;
  status: 'idle' | 'hint' | 'retry' | 'unclear' | 'correct';
  selected: string | null;
  assisted: boolean;
  highlighted: boolean;
  awardId: number;
  awardKind: 'answer' | 'speech';
}
type InteractionAction = { type: 'answer'; ids: string[] } | { type: 'hint' | 'next' | 'reset' | 'praise' };
export function createInteraction(): InteractionState {
  return { taskIndex: 0, status: 'idle', selected: null, assisted: false, highlighted: false, awardId: 0, awardKind: 'answer' };
}
export function interactionReducer(state: InteractionState, action: InteractionAction): InteractionState {
  if (action.type === 'praise') return { ...state, awardId: state.awardId + 1, awardKind: 'speech' };
  if (action.type === 'next' || action.type === 'reset') return { ...createInteraction(), taskIndex: action.type === 'next' ? (state.taskIndex + 1) % INTERACTION_TASKS.length : 0, awardId: state.awardId };
  if (state.status === 'correct') return state;
  if (action.type === 'hint') return { ...state, status: 'hint', selected: null, assisted: true, highlighted: true };
  if (action.type !== 'answer') return state;
  const ids = [...new Set(action.ids)];
  if (ids.length !== 1 || !ANSWERS.has(ids[0])) return { ...state, status: 'unclear', selected: null };
  const correct = ids[0] === INTERACTION_TASKS[state.taskIndex].target;
  return { ...state, selected: ids[0], assisted: state.assisted || !correct, status: correct ? 'correct' : 'retry', awardId: state.awardId + (correct ? 1 : 0), awardKind: 'answer' };
}

export function selectionForMark(mark: PrototypeMark, objects: PageObject[]): string[] | null {
  if (!mark.points.length) return null;
  const box = pointsBox(mark.points);
  if (box.w < .015 && box.h < .015) return null;
  const first = mark.points[0], last = mark.points.at(-1)!;
  if (mark.tool === 'pen' && (mark.points.length < 8 || Math.hypot(first.x - last.x, first.y - last.y) > .06)) return null;
  return [...new Set(resolveSelection(mark.points, objects, mark.tool).ids)];
}
