import {DEFAULT_TEACHER_MODELS,type TeacherModel,type FrozenTeacherConfig} from '../teacher-agent';
import type {ResolvedModelCredentials} from '../model-credentials';
import type {ClassroomSnapshot} from '../classroom-contract';
import type {ClassroomVoiceConfig} from './classroom-sockets';
type Provider='qwen'|'openai';
type Purpose=TeacherModel['purpose'];
export function createTeacherCredentialRoutes(resolve:(model:Pick<TeacherModel,'id'|'provider'>)=>Promise<ResolvedModelCredentials>,env:(name:string)=>string|undefined){
 async function forModel(provider:Provider,purpose:Purpose,model?:TeacherModel|null){
  if(model===null||model&&(model.provider!==provider||model.purpose!==purpose))throw new Error('模型凭据路线不可用。');
  const identity=model??DEFAULT_TEACHER_MODELS.find(item=>item.input.provider===provider&&item.input.purpose===purpose);
  if(!identity)throw new Error('模型凭据路线不可用。');
  return resolve({id:identity.id,provider});
 }
 async function availability(config:FrozenTeacherConfig|null){
  const result={qwen:false,openai:false};
  await Promise.all((['qwen','openai'] as const).map(async provider=>{
   if(config&&!config.routes[provider]||provider==='openai'&&env('OPENAI_CHILD_DATA_READY')!=='true')return;
   try{await forModel(provider,'realtime',config?.routes[provider]?.realtime);result[provider]=true;}catch{}
  }));return result;
 }
 async function voice(snapshot:ClassroomSnapshot,config:FrozenTeacherConfig|null):Promise<ClassroomVoiceConfig>{
  const provider=snapshot.preferences.provider,route=config?.routes[provider];
  if(config&&!route)throw new Error('模型凭据路线不可用。');
  const credential=await forModel(provider,'realtime',route?.realtime);
  const fallback=DEFAULT_TEACHER_MODELS.find(item=>item.input.provider===provider&&item.input.purpose==='realtime')!;
  return{key:credential.apiKey,workspaceId:credential.workspaceId,region:credential.region,
   model:route?.realtime.model||env(provider==='qwen'?'QWEN_REALTIME_MODEL':'OPENAI_LIVE_MODEL')||fallback.input.model,
   voice:config?.voices[provider][snapshot.preferences.voice]??(provider==='qwen'?(snapshot.preferences.voice==='male'?'Aiden':'Jennifer'):(snapshot.preferences.voice==='male'?'meridian':'gleam')),
   childDataReady:provider==='openai'?env('OPENAI_CHILD_DATA_READY')==='true':undefined};
 }
 return{forModel,availability,voice};
}
