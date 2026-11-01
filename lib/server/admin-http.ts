import {z} from 'zod';
import {teacherAgentInputSchema,teacherModelInputSchema} from '../teacher-agent';
import {accountResponse} from './account-http';
import type {AdminService} from './admin-service';
import {hasAdminHost} from './admin-origin';

export const adminPreviewSchema=z.object({
 agent:teacherAgentInputSchema,profile:z.object({name:z.string().trim().min(1).max(30),ageRange:z.enum(['8–9','10–11','12–13']),level:z.enum(['starter','sentences','conversation','unsure'])}).strict(),
 preferences:z.object({provider:z.enum(['qwen','openai']),language:z.enum(['english','bilingual']),style:z.enum(['gentle','focused','strict']),voice:z.enum(['female','male']),soundEffects:z.boolean()}).strict(),
}).strict();
export type AdminPreviewInput=z.infer<typeof adminPreviewSchema>;
export const adminTryoutSchema=adminPreviewSchema.extend({text:z.string().trim().min(1).max(1000),taskId:z.string().min(1).max(80)}).strict();
export type AdminTryoutInput=z.infer<typeof adminTryoutSchema>;
type Dependencies={origin:string;service:AdminService;authenticate:(request:Request)=>Promise<{id:string}|null>;providers:()=>{qwen:boolean;openai:boolean};limit:(id:string,tryout:boolean)=>Promise<void>;preview:(id:string,input:AdminPreviewInput)=>Promise<string>;tryout:(id:string,input:AdminTryoutInput)=>Promise<unknown>;problem?:(error:unknown)=>{code:string;message:string;status:number}|null};
class AdminHttpProblem extends Error{constructor(public code:string,message:string,public status:number){super(message);}}
const fail=(code:string,message:string,status:number):never=>{throw new AdminHttpProblem(code,message,status);};
const uuid=z.string().uuid(),revision=z.number().int().positive();
async function json(request:Request){
 if(request.headers.get('content-type')?.split(';')[0].toLowerCase().trim()!=='application/json')fail('CONTENT_TYPE','请使用JSON提交配置。',415);
 const length=Number(request.headers.get('content-length')||0);if(!Number.isFinite(length)||length<0||length>65536)fail('BODY_TOO_LARGE','配置内容过长。',413);
 const reader=request.body?.getReader();if(!reader)fail('INVALID_INPUT','配置内容无效。',400);
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader!.read();if(done)break;size+=value.byteLength;if(size>65536){await reader!.cancel();fail('BODY_TOO_LARGE','配置内容过长。',413);}chunks.push(value);}}finally{reader!.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return fail('INVALID_INPUT','配置内容无效。',400);}
}
export function isAdminApi(path:string){return path==='/api/v1/admin'||path.startsWith('/api/v1/admin/');}
export function createAdminHandler(deps:Dependencies){return async(request:Request):Promise<Response>=>{
 try{
  const url=new URL(request.url),path=url.pathname.replace(/^\/api\/v1\/admin/,'')||'/';
  if(!hasAdminHost(request,deps.origin))fail('ORIGIN','管理后台地址不正确。',403);
  const user=await deps.authenticate(request);if(!user)fail('UNAUTHORIZED','请先登录。',401);
  if(!await deps.service.isAdmin(user!.id))fail('FORBIDDEN','此账号没有管理权限。',403);
  const write=request.method==='POST'||request.method==='PATCH';
  if(write&&(request.headers.get('origin')!==deps.origin||request.headers.get('sec-fetch-site')==='cross-site'))fail('ORIGIN','请求来源无效，请刷新重试。',403);
  if(request.method==='GET'){
   await deps.limit(user!.id,false);
   if(path==='/config')return accountResponse({ok:true,...await deps.service.config(user!.id),providers:deps.providers()});
   if(path==='/overview'){const days=z.enum(['7','30']).parse(url.searchParams.get('days')??'7');return accountResponse({ok:true,overview:await deps.service.overview(user!.id,Number(days))});}
   if(path==='/users'){const page=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get('page')??0),pageSize=z.coerce.number().int().min(1).max(50).parse(url.searchParams.get('pageSize')??20);return accountResponse({ok:true,...await deps.service.users(user!.id,{page,pageSize})});}
   fail('NOT_FOUND','管理接口不存在。',404);
  }
  if(!write)fail('METHOD','不支持此请求方式。',405);
  await deps.limit(user!.id,path==='/tryout');const body=await json(request);
  if(request.method==='POST'){
   if(path==='/models')return accountResponse({ok:true,model:await deps.service.createModel(user!.id,teacherModelInputSchema.parse(body))});
   if(path==='/agents')return accountResponse({ok:true,agent:await deps.service.createAgent(user!.id,teacherAgentInputSchema.parse(body))});
   if(path==='/preview')return accountResponse({ok:true,prompt:await deps.preview(user!.id,adminPreviewSchema.parse(body))});
   if(path==='/tryout')return accountResponse({ok:true,result:await deps.tryout(user!.id,adminTryoutSchema.parse(body))});
   const publish=/^\/agents\/([^/]+)\/publish$/.exec(path);
   if(publish){const id=uuid.parse(publish[1]),data=z.object({expectedRevision:revision}).strict().parse(body);return accountResponse({ok:true,release:await deps.service.publishAgent(user!.id,id,data.expectedRevision)});}
   const activate=/^\/releases\/([^/]+)\/activate$/.exec(path);
   if(activate){const id=uuid.parse(activate[1]);z.object({}).strict().parse(body);return accountResponse({ok:true,release:await deps.service.activateRelease(user!.id,id)});}
  }
  if(request.method==='PATCH'){
   const target=/^\/(models|agents)\/([^/]+)$/.exec(path);
   if(target){const id=uuid.parse(target[2]);if(!body||typeof body!=='object'||Array.isArray(body))fail('INVALID_INPUT','配置内容无效。',400);const {expectedRevision,...input}=body as Record<string,unknown>;const expected=revision.parse(expectedRevision);
    if(target[1]==='models')return accountResponse({ok:true,model:await deps.service.updateModel(user!.id,id,expected,teacherModelInputSchema.parse(input))});
    return accountResponse({ok:true,agent:await deps.service.updateAgent(user!.id,id,expected,teacherAgentInputSchema.parse(input))});
   }
  }
  return fail('NOT_FOUND','管理接口不存在。',404);
 }catch(error){
  if(error instanceof z.ZodError)return accountResponse({ok:false,error:{code:'INVALID_INPUT',message:'请检查配置字段、参数范围或版本号。'}},400);
  const known=error instanceof AdminHttpProblem?error:deps.problem?.(error);
  if(known)return accountResponse({ok:false,error:{code:known.code,message:known.message}},known.status);
  return accountResponse({ok:false,error:{code:'UNAVAILABLE',message:'管理服务暂时不可用，请稍后重试。'}},503);
 }
};}
