import {getAccountPool} from '../../db/postgres';
import {AdminError,AdminService,initializeTeacherAgents} from './admin-service';
import {getAccountService} from './account-runtime';
import {AccountError} from './account-service';
import {accountResponse} from './account-http';
import {createAdminHandler,type AdminPreviewInput,type AdminTryoutInput} from './admin-http';
import {readRuntimeEnv} from './runtime-env';
import {buildTeacherInstructions} from '../teacher-instructions';
import {createTeacherAssessment} from './teacher-assessment';
import {PICNIC_COURSE} from './course-catalog';
import {adminOrigin} from './admin-origin';
import {adminSessionCookie} from './admin-auth-http';
import {getAdminAuthService,handleAdminAuthRequest} from './admin-auth-runtime';
import {getModelCredentialsService,getTeacherCredentialRoutes} from './model-credentials-runtime';
import {ModelCredentialsError} from './model-credentials';
import type {ClassroomSnapshot} from '../classroom-contract';
let service:AdminService|undefined,initializing:Promise<void>|undefined;
export function adminProblem(error:unknown){return error instanceof AdminError||error instanceof AccountError||error instanceof ModelCredentialsError?error:null;}
export async function getAdminService(){
 const pool=getAccountPool(readRuntimeEnv('DATABASE_URL'));
 if(!initializing)initializing=initializeTeacherAgents(pool).catch(error=>{initializing=undefined;throw error;});
 await initializing;return service??=new AdminService(pool);
}
async function providerStatus(accountId:string){
 const config=await(await getAdminService()).config(accountId),credentials=getModelCredentialsService(),result={qwen:false,openai:false};
 await Promise.all(config.models.filter(model=>model.enabled).map(async model=>{if(model.provider==='openai'&&readRuntimeEnv('OPENAI_CHILD_DATA_READY')!=='true')return;try{await credentials.resolve(model);result[model.provider]=true;}catch{}}));return result;
}
function trialSnapshot(input:AdminPreviewInput,taskId='my-choice'):ClassroomSnapshot{
 const index=PICNIC_COURSE.steps.findIndex(step=>step.id===taskId);if(index<0)throw new AdminError('INVALID_TASK','试教活动不存在。',400);
 return{id:'00000000-0000-4000-8000-000000000001',course:PICNIC_COURSE,profile:input.profile,preferences:input.preferences,status:'active',revision:0,connectionEpoch:0,stepIndex:index,elapsedSeconds:0,remainingSeconds:900,maxSeconds:900,outcomes:[],teacherObjectIds:[],feedback:null,endReason:null,startedAt:new Date().toISOString(),endedAt:null,reportStatus:'unavailable'};
}
async function preview(accountId:string,input:AdminPreviewInput){const config=await(await getAdminService()).resolveDraft(accountId,input.agent);return buildTeacherInstructions(trialSnapshot(input),config);}
async function tryout(accountId:string,input:AdminTryoutInput){
 const admin=await getAdminService(),config=await admin.resolveDraft(accountId,input.agent),provider=input.preferences.provider;
 const model=config.routes[provider]?.reasoning;if(!model||provider==='openai'&&readRuntimeEnv('OPENAI_CHILD_DATA_READY')!=='true')throw new AdminError('MODEL_UNAVAILABLE','请绑定并配置对应服务的教学判断模型。',503);
 const credential=await getTeacherCredentialRoutes().forModel(provider,'reasoning',model);
 const assess=createTeacherAssessment({provider,model:model.model,...credential});
 const result=await assess({snapshot:trialSnapshot(input,input.taskId),config,text:input.text},AbortSignal.timeout(9000));
 if(!await admin.isAdmin(accountId))throw new AdminError('FORBIDDEN','此账号没有管理权限。',403);
 return result;
}
export async function handleAdminRequest(request:Request){
 try{
  if(new URL(request.url).pathname.startsWith('/api/v1/admin/auth/'))return handleAdminAuthRequest(request);
  const accounts=getAccountService(),admin=await getAdminService(),credentials=getModelCredentialsService();
  return createAdminHandler({origin:adminOrigin(),service:admin,authenticate:req=>getAdminAuthService().session(adminSessionCookie(req)),providers:providerStatus,
   limit:(id,isTryout)=>accounts.limit(`admin:${isTryout?'tryout':'request'}:${id}`,isTryout?6:120,60),preview,tryout,
   problem:adminProblem,
   credentials:{status:(...args)=>credentials.status(...args),set:(...args)=>credentials.set(...args),reset:(...args)=>credentials.reset(...args)},
  })(request);
 }catch{return accountResponse({ok:false,error:{code:'UNAVAILABLE',message:'管理服务暂时不可用，请稍后重试。'}},503);}
}
