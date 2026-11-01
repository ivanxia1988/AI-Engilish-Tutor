import {z} from 'zod';
const revision=z.number().int().nonnegative();
const apiKey=z.string().trim().min(8).max(1024).regex(/^\S+$/,'密钥中不能包含空格或换行');
export const modelCredentialInputSchema=z.discriminatedUnion('provider',[
 z.object({provider:z.literal('openai'),expectedRevision:revision,apiKey}).strict(),
 z.object({provider:z.literal('qwen'),expectedRevision:revision,apiKey,workspaceId:z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),region:z.enum(['cn-beijing','ap-southeast-1'])}).strict(),
]);
export const modelCredentialResetSchema=z.object({provider:z.enum(['qwen','openai']),expectedRevision:revision}).strict();
export const modelCredentialStatusSchema=z.object({provider:z.enum(['qwen','openai']),source:z.enum(['model','environment','missing']),configured:z.boolean(),revision,updatedAt:z.string().nullable()}).strict();
export type ModelCredentialInput=z.infer<typeof modelCredentialInputSchema>;
export type ModelCredentialReset=z.infer<typeof modelCredentialResetSchema>;
export type ModelCredentialStatus=z.infer<typeof modelCredentialStatusSchema>;
export type ResolvedModelCredentials={apiKey:string;workspaceId?:string;region?:'cn-beijing'|'ap-southeast-1'};
