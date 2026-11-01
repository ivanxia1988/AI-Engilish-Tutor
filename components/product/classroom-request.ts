import { z } from 'zod';
import type { ClassroomSnapshot, CourseCard } from '../../lib/classroom-contract';
import { accountRequest } from './account-request';

export const classroomPreferencesSchema = z.object({ provider: z.enum(['qwen', 'openai']), language: z.enum(['english', 'bilingual']), style: z.enum(['gentle', 'focused', 'strict']), voice: z.enum(['female', 'male']), soundEffects: z.boolean() });
const box = z.object({ x:z.number().min(0).max(1), y:z.number().min(0).max(1), w:z.number().positive().max(1), h:z.number().positive().max(1) });
const page = z.object({ id:z.string().min(1), image:z.string().min(1), width:z.number().positive(),height:z.number().positive(),objects:z.array(z.object({id:z.string(),label:z.string(),chinese:z.string(),box})).max(40) });
const step = z.object({ id:z.string(),kind:z.enum(['listen','select','speak']),pageId:z.string(),targetId:z.string().nullable(),english:z.string(),chinese:z.string(),hint:z.string(),expected:z.string().nullable() });
const courseFields = { id:z.string().min(1),version:z.string().min(1),title:z.string().min(1),subtitle:z.string(),description:z.string(),words:z.array(z.string()),objectives:z.array(z.string()),durationMinutes:z.number().positive() };
export const classroomId = z.string().uuid();
export const classroomSnapshotSchema: z.ZodType<ClassroomSnapshot> = z.object({
 id:classroomId,course:z.object({...courseFields,pages:z.array(page).min(1),steps:z.array(step).min(1)}),profile:z.object({name:z.string(),ageRange:z.string(),level:z.string()}),preferences:classroomPreferencesSchema,
 status:z.enum(['preflight','active','paused','ended']),revision:z.number().int().nonnegative(),connectionEpoch:z.number().int().nonnegative(),stepIndex:z.number().int().nonnegative(),elapsedSeconds:z.number().nonnegative(),remainingSeconds:z.number().nonnegative(),maxSeconds:z.number().positive(),
 outcomes:z.array(z.object({stepId:z.string(),status:z.enum(['independent','assisted','skipped','unassessed'])})),teacherObjectIds:z.array(z.string()),feedback:z.object({id:z.string(),kind:z.enum(['correct','retry','ambiguous','hint','skipped']),message:z.string()}).nullable(),endReason:z.enum(['manual','content_completed','time_limit','daily_limit']).nullable(),startedAt:z.string(),endedAt:z.string().nullable(),reportStatus:z.literal('unavailable')
});
const card: z.ZodType<CourseCard> = z.object({...courseFields,progress:z.object({stepIndex:z.number().int().nonnegative(),completed:z.boolean()})});
export const coursesResponse = z.object({ok:z.literal(true),courses:z.array(card),activeClassroom:z.object({id:classroomId,courseId:z.string(),status:z.string()}).nullable().default(null),recentClassrooms:z.array(z.object({id:classroomId,courseTitle:z.string(),endedAt:z.string(),endReason:z.enum(['manual','content_completed','time_limit','daily_limit']),elapsedSeconds:z.number().nonnegative()})).max(6).default([])});
export const classroomResponse = z.object({ok:z.literal(true),classroom:classroomSnapshotSchema});
export const classroomOptionsResponse = z.object({ok:z.literal(true),providers:z.array(z.object({id:z.enum(['qwen','openai']),name:z.string(),configured:z.boolean()})),preferences:classroomPreferencesSchema});
export const savedPreferencesResponse = z.object({ok:z.literal(true),preferences:classroomPreferencesSchema});
export const readClassroom = async (id: string, signal?: AbortSignal) => accountRequest(`/classrooms/${classroomId.parse(id)}`,classroomResponse,{signal});
export function navigateClassroom(path: string) {
 if (['/', '/login', '/courses', '/onboarding'].includes(path) || /^\/classroom\/[\da-f-]{36}$/i.test(path)) window.location.assign(path);
}
