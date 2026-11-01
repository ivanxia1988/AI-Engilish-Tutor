import {z} from 'zod';
import {teacherAgentInputSchema,teacherProviderSchema} from '../../lib/teacher-agent';
import {accountRequest} from '../product/account-request';

const identifier=z.string().uuid(),date=z.string().min(1),count=z.number().int().nonnegative();
export const modelRecordSchema=z.object({id:identifier,revision:count.positive(),name:z.string(),provider:teacherProviderSchema,purpose:z.enum(['realtime','reasoning','vision']),model:z.string(),enabled:z.boolean(),createdAt:date,updatedAt:date});
export const agentRecordSchema=teacherAgentInputSchema.extend({id:identifier,revision:count.positive(),createdAt:date,updatedAt:date});
export const releaseSchema=z.object({id:identifier,agentId:identifier,agentName:z.string(),version:count.positive(),publishedAt:date});
export const configResponse=z.object({ok:z.literal(true),models:z.array(modelRecordSchema).max(1000),agents:z.array(agentRecordSchema).max(1000),releases:z.array(releaseSchema).max(1000),activeRelease:releaseSchema.nullable(),providers:z.object({qwen:z.boolean(),openai:z.boolean()})});
export const modelResponse=z.object({ok:z.literal(true),model:modelRecordSchema});
export const agentResponse=z.object({ok:z.literal(true),agent:agentRecordSchema});
export const releaseResponse=z.object({ok:z.literal(true),release:releaseSchema});
export const overviewResponse=z.object({ok:z.literal(true),overview:z.object({days:z.number().int().min(1).max(366),registeredUsers:count,profiledUsers:count,newUsers:count,activeUsers:count,classroomCount:count,endedCount:count,usageSeconds:z.number().nonnegative(),providerUsage:z.array(z.object({provider:teacherProviderSchema,seconds:z.number().nonnegative(),classrooms:count})),endings:z.array(z.object({reason:z.string(),count}))})});
export const usersResponse=z.object({ok:z.literal(true),users:z.array(z.object({id:identifier,email:z.string().email(),name:z.string().nullable(),createdAt:date,profileComplete:z.boolean(),classroomCount:count,usageSeconds:z.number().nonnegative(),lastClassroomAt:date.nullable()})).max(50),total:count,page:count,pageSize:count.positive().max(50)});
export const previewResponse=z.object({ok:z.literal(true),prompt:z.string().min(1).max(60000)});
export const tryoutResponse=z.object({ok:z.literal(true),result:z.object({decision:z.enum(['correct','retry','conversation','clarify']),confidence:z.enum(['high','low']),reason:z.string().max(1000),suggestedResponse:z.string().max(2000),nextAction:z.string().max(300)})});
export type AdminConfigData=z.infer<typeof configResponse>;
export const adminRequest=<T extends z.ZodTypeAny>(path:string,schema:T,options:Parameters<typeof accountRequest>[2]={})=>accountRequest(`/admin${path}`,schema,options);
