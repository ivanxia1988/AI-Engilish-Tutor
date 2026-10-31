import { z } from 'zod';
import { accountResponse, boundedJson } from './account-http';
import { ClassroomError, type ClassroomService } from './classroom-service';
import type { ClassroomPreferences } from '../classroom-contract';

export const preferencesSchema=z.object({provider:z.enum(['qwen','openai']),language:z.enum(['english','bilingual']),style:z.enum(['gentle','focused','strict']),voice:z.enum(['female','male']),soundEffects:z.boolean()}).strict();
const createSchema=z.object({courseId:z.string().min(1).max(80),preferences:preferencesSchema.optional()}).strict();
const actionSchema=z.object({eventId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),type:z.enum(['select','hint','next','skip','pause','resume','end']),objectIds:z.array(z.string().min(1).max(80)).max(5).optional()}).strict();
const classroomPath=/^\/classrooms\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/actions)?$/i;
export function isClassroomApi(path:string){return ['/api/v1/courses','/api/v1/classroom-options','/api/v1/preferences','/api/v1/classrooms'].includes(path)||path.startsWith('/api/v1/classrooms/');}
type Provider={id:'qwen'|'openai';name:string;configured:boolean};
type Dependencies={origin:string;service:ClassroomService;authenticate:(request:Request)=>Promise<{id:string;profileComplete:boolean}|null>;providers:()=>Provider[];limit:(accountId:string)=>Promise<void>;changed?:(id:string)=>Promise<void>};
export function createClassroomHandler(deps:Dependencies){return async(request:Request)=>{
  try{
    const path=new URL(request.url).pathname.replace(/^\/api\/v1/,'');
    const match=classroomPath.exec(path);
    if(!['/courses','/classroom-options','/preferences','/classrooms'].includes(path)&&!match)throw new ClassroomError('NOT_FOUND','接口不存在。',404);
    const write=request.method==='POST'||request.method==='PATCH';
    if(write&&(request.headers.get('origin')!==deps.origin||request.headers.get('sec-fetch-site')==='cross-site'))throw new ClassroomError('ORIGIN','请求来源无效，请刷新重试。',403);
    const user=await deps.authenticate(request);
    if(!user)throw new ClassroomError('UNAUTHORIZED','请先登录。',401);
    if(!user.profileComplete)throw new ClassroomError('PROFILE_REQUIRED','请先填写孩子档案。');
    if(request.method==='GET'){
      if(path==='/courses')return accountResponse({ok:true,...await deps.service.courses(user.id)});
      if(path==='/classroom-options')return accountResponse({ok:true,providers:deps.providers(),preferences:await deps.service.preferences(user.id)});
      if(match&&!match[2])return accountResponse({ok:true,classroom:await deps.service.get(user.id,match[1])});
      throw new ClassroomError('METHOD','不支持此请求方式。',405);
    }
    if(!write)throw new ClassroomError('METHOD','不支持此请求方式。',405);
    const body=await boundedJson(request);await deps.limit(user.id);
    if(path==='/preferences'&&request.method==='PATCH'){
      const data=preferencesSchema.parse(body);
      return accountResponse({ok:true,preferences:await deps.service.savePreferences(user.id,data)});
    }
    if(request.method!=='POST')throw new ClassroomError('METHOD','不支持此请求方式。',405);
    if(path==='/classrooms'){
      const data=createSchema.parse(body),preferences:ClassroomPreferences=data.preferences??await deps.service.preferences(user.id);
      if(!deps.providers().some(provider=>provider.id===preferences.provider&&provider.configured))throw new ClassroomError('VOICE_UNAVAILABLE','所选语音服务尚未配置，请选择可用的服务。',503);
      return accountResponse({ok:true,classroom:await deps.service.create(user.id,data.courseId,preferences)});
    }
    if(match?.[2]){
      const classroom=await deps.service.action(user.id,match[1],actionSchema.parse(body));
      await deps.changed?.(match[1]);
      return accountResponse({ok:true,classroom});
    }
    throw new ClassroomError('METHOD','不支持此请求方式。',405);
  }catch(error){
    if(error instanceof z.ZodError)return accountResponse({ok:false,error:{code:'INVALID_INPUT',message:'请求内容无效，请重新操作。'}},400);
    if(error&&typeof error==='object'&&'code'in error&&'status'in error&&'message'in error&&typeof error.code==='string'&&typeof error.status==='number'&&typeof error.message==='string')return accountResponse({ok:false,error:{code:error.code,message:error.message}},error.status);
    return accountResponse({ok:false,error:{code:'UNAVAILABLE',message:'课堂服务暂时不可用，请稍后重试。'}},503);
  }
};}
