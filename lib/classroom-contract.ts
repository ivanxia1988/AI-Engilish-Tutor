import type { BookPage, LessonStep } from './types';

export type ClassroomPreferences = {
  provider: 'qwen' | 'openai';
  language: 'english' | 'bilingual';
  style: 'gentle' | 'focused' | 'strict';
  voice: 'female' | 'male';
  soundEffects: boolean;
};
export type PublishedCourse = {
  id: string; version: string; title: string; subtitle: string; description: string;
  words: string[]; objectives: string[]; durationMinutes: number;
  pages: BookPage[]; steps: LessonStep[];
};
export type CourseCard = Omit<PublishedCourse, 'pages' | 'steps'> & {
  progress: { stepIndex: number; completed: boolean };
};
export type ClassroomOutcome = {
  stepId: string; status: 'independent' | 'assisted' | 'skipped' | 'unassessed';
};
export type ClassroomFeedback = {
  id: string; kind: 'correct' | 'retry' | 'ambiguous' | 'hint' | 'skipped'; message: string;
};
export type ClassroomSnapshot = {
  id: string; course: PublishedCourse;
  profile: { name: string; ageRange: string; level: string };
  preferences: ClassroomPreferences;
  status: 'preflight' | 'active' | 'paused' | 'ended';
  revision: number; connectionEpoch: number; stepIndex: number;
  elapsedSeconds: number; remainingSeconds: number; maxSeconds: number;
  outcomes: ClassroomOutcome[]; teacherObjectIds: string[];
  feedback: ClassroomFeedback | null;
  endReason: 'manual' | 'content_completed' | 'time_limit' | 'daily_limit' | null;
  startedAt: string; endedAt: string | null;
  reportStatus: 'unavailable';
};
export type ClassroomAction = {
  eventId: string; expectedRevision: number;
  type: 'select' | 'hint' | 'next' | 'skip' | 'pause' | 'resume' | 'end';
  objectIds?: string[];
};
export type RecentClassroom = {
  id:string; courseTitle:string; endedAt:string;
  endReason:NonNullable<ClassroomSnapshot['endReason']>; elapsedSeconds:number;
};
