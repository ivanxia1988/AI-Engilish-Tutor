import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {DEFAULT_TEACHER_AGENT,DEFAULT_TEACHER_AGENT_ID,DEFAULT_TEACHER_MODELS,teacherAgentInputSchema,teacherModelInputSchema,type AdminConfig,type AdminOverview,type AdminUsers,type FrozenTeacherConfig,type TeacherAgent,type TeacherAgentInput,type TeacherModel,type TeacherModelInput,type TeacherRelease} from '../teacher-agent';

export class AdminError extends Error {
 constructor(public code:string,message:string,public status=409){super(message);}
}
function fail(code:string,message:string,status=409):never{throw new AdminError(code,message,status);}
const identifier=(value:string)=>{if(!z.string().uuid().safeParse(value).success)fail('INVALID_INPUT','请求标识无效。',400);return value;};
const revision=(value:number)=>{if(!Number.isInteger(value)||value<1)fail('INVALID_INPUT','配置版本无效。',400);return value;};
const input=<T>(schema:z.ZodType<T>,value:unknown):T=>{const parsed=schema.safeParse(value);if(!parsed.success)fail('INVALID_INPUT','请检查配置内容和参数范围。',400);return parsed.data;};
type ConfigRow={id:string;revision:number;config:unknown;created_at:Date;updated_at:Date};
type ReleaseRow={id:string;agent_id:string;version:number;config:FrozenTeacherConfig;published_at:Date};
type Database=Pick<PoolClient,'query'>;
const lock=(db:Database)=>db.query("SELECT pg_advisory_xact_lock(hashtext('teeko-teacher-config'))");
const model=(row:ConfigRow):TeacherModel=>({...teacherModelInputSchema.parse(row.config),id:row.id,revision:row.revision,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString()});
const agent=(row:ConfigRow):TeacherAgent=>({...teacherAgentInputSchema.parse(row.config),id:row.id,revision:row.revision,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString()});
const release=(row:ReleaseRow):TeacherRelease=>({id:row.id,agentId:row.agent_id,agentName:row.config.agentName,version:row.version,publishedAt:row.published_at.toISOString()});
async function transaction<T>(pool:Pool,work:(db:PoolClient)=>Promise<T>):Promise<T>{
 const db=await pool.connect();
 try{await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result;}
 catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
async function resolve(db:Database,value:TeacherAgentInput,identity:TeacherRelease):Promise<FrozenTeacherConfig>{
 const ids=[value.routes.qwen.realtimeModelId,value.routes.qwen.reasoningModelId,value.routes.openai.realtimeModelId,value.routes.openai.reasoningModelId,value.routes.openai.visionModelId].filter((id):id is string=>id!==null);
 const rows=(await db.query('SELECT * FROM teeko_teacher_models WHERE id=ANY($1::uuid[])',[ids])).rows as ConfigRow[];
 const models=new Map(rows.map(row=>[row.id,model(row)]));
 const binding=(id:string|null,provider:'qwen'|'openai',purpose:TeacherModelInput['purpose']):TeacherModel|null=>{
  if(!id)return null;const selected=models.get(id);
  if(!selected||!selected.enabled||selected.provider!==provider||selected.purpose!==purpose)fail('MODEL_BINDING','绑定模型不存在、已停用或与服务和用途不符。');
  return selected;
 };
 const qwenLive=binding(value.routes.qwen.realtimeModelId,'qwen','realtime'),qwenReasoning=binding(value.routes.qwen.reasoningModelId,'qwen','reasoning');
 const openaiLive=binding(value.routes.openai.realtimeModelId,'openai','realtime'),openaiReasoning=binding(value.routes.openai.reasoningModelId,'openai','reasoning'),vision=binding(value.routes.openai.visionModelId,'openai','vision');
 if(!qwenLive&&!openaiLive)fail('MODEL_BINDING','至少绑定一条实时课堂路线。');
 if((!qwenLive&&qwenReasoning)||(!openaiLive&&(openaiReasoning||vision)))fail('MODEL_BINDING','教学判断和视觉模型需要对应的实时课堂路线。');
 return {...identity,systemPrompt:value.systemPrompt,policy:value.policy,voices:value.voices,routes:{qwen:qwenLive?{realtime:qwenLive,reasoning:qwenReasoning}:null,openai:openaiLive?{realtime:openaiLive,reasoning:openaiReasoning,vision}:null}};
}
async function insertRelease(db:Database,value:TeacherAgentInput,agentId:string,version:number,now:Date,actor:string|null){
 if(!value.enabled)fail('AGENT_DISABLED','启用智能体后才能发布。');
 const summary:TeacherRelease={id:randomUUID(),agentId,agentName:value.name,version,publishedAt:now.toISOString()};
 const frozen=await resolve(db,value,summary);
 await db.query('INSERT INTO teeko_teacher_releases(id,agent_id,version,config,published_at,created_by) VALUES($1,$2,$3,$4,$5,$6)',[summary.id,agentId,version,JSON.stringify(frozen),now,actor]);
 await db.query('INSERT INTO teeko_teacher_active(singleton,release_id,updated_at) VALUES(true,$1,$2) ON CONFLICT(singleton) DO UPDATE SET release_id=EXCLUDED.release_id,updated_at=EXCLUDED.updated_at',[summary.id,now]);
 return summary;
}

/** Called after migrations. System defaults never implicitly grant an administrator. */
export async function initializeTeacherAgents(pool:Pool):Promise<void>{
 await transaction(pool,async db=>{
  await lock(db);
  for(const entry of DEFAULT_TEACHER_MODELS)await db.query('INSERT INTO teeko_teacher_models(id,config) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[entry.id,JSON.stringify(entry.input)]);
  await db.query('INSERT INTO teeko_teacher_agents(id,config) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[DEFAULT_TEACHER_AGENT_ID,JSON.stringify(DEFAULT_TEACHER_AGENT)]);
  if((await db.query('SELECT 1 FROM teeko_teacher_active WHERE singleton=true')).rowCount)return;
  const stored=(await db.query('SELECT * FROM teeko_teacher_agents WHERE id=$1',[DEFAULT_TEACHER_AGENT_ID])).rows[0] as ConfigRow;
  const value=agent(stored),version=Number((await db.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM teeko_teacher_releases WHERE agent_id=$1',[stored.id])).rows[0].version);
  await insertRelease(db,value,stored.id,version,new Date(),null);
 });
}
export async function resolvePublishedTeacher(db:Database):Promise<FrozenTeacherConfig|null>{
 const result=await db.query('SELECT r.config FROM teeko_teacher_active a JOIN teeko_teacher_releases r ON r.id=a.release_id WHERE a.singleton=true');
 return result.rows[0]?.config??null;
}

export class AdminService {
 private readonly now:()=>Date;
 constructor(private readonly pool:Pool,options:{now?:()=>Date}={}){this.now=options.now??(()=>new Date());}
 async isAdmin(accountId:string):Promise<boolean>{identifier(accountId);return Boolean((await this.pool.query('SELECT 1 FROM teeko_admin_accounts WHERE account_id=$1',[accountId])).rowCount);}
 /** Operator CLI only; HTTP exposes neither role-management method. */
 async grantAdmin(accountId:string):Promise<void>{
  identifier(accountId);
  await transaction(this.pool,async db=>{if(!(await db.query('SELECT id FROM teeko_accounts WHERE id=$1 FOR KEY SHARE',[accountId])).rowCount)fail('NOT_FOUND','账号不存在。',404);await db.query('INSERT INTO teeko_admin_accounts(account_id,granted_at) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING',[accountId,this.now()]);});
 }
 async revokeAdmin(accountId:string):Promise<void>{identifier(accountId);await this.pool.query('DELETE FROM teeko_admin_accounts WHERE account_id=$1',[accountId]);}
 private async authorized<T>(accountId:string,work:(db:PoolClient)=>Promise<T>):Promise<T>{
  identifier(accountId);
  return transaction(this.pool,async db=>{if(!(await db.query('SELECT account_id FROM teeko_admin_accounts WHERE account_id=$1 FOR SHARE',[accountId])).rowCount)fail('FORBIDDEN','此账号没有管理权限。',403);return work(db);});
 }
 async config(accountId:string):Promise<AdminConfig>{return this.authorized(accountId,async db=>{
  const models=(await db.query('SELECT * FROM teeko_teacher_models ORDER BY created_at,id')).rows.map(model);
  const agents=(await db.query('SELECT * FROM teeko_teacher_agents ORDER BY created_at,id')).rows.map(agent);
  const releases=(await db.query('SELECT * FROM teeko_teacher_releases ORDER BY published_at DESC,id DESC LIMIT 100')).rows.map(release);
  const activeRow=(await db.query('SELECT r.* FROM teeko_teacher_active a JOIN teeko_teacher_releases r ON r.id=a.release_id WHERE a.singleton=true')).rows[0];
  return {models,agents,releases,activeRelease:activeRow?release(activeRow):null};
 });}
 async createModel(accountId:string,value:TeacherModelInput):Promise<TeacherModel>{return this.authorized(accountId,async db=>{
  const config=input(teacherModelInputSchema,value);await lock(db);const now=this.now();
  const row=(await db.query('INSERT INTO teeko_teacher_models(id,config,created_at,updated_at) VALUES($1,$2,$3,$3) RETURNING *',[randomUUID(),JSON.stringify(config),now])).rows[0];return model(row);
 });}
 async updateModel(accountId:string,id:string,expectedRevision:number,value:TeacherModelInput):Promise<TeacherModel>{return this.authorized(accountId,async db=>{
  identifier(id);revision(expectedRevision);const config=input(teacherModelInputSchema,value);await lock(db);
  const previous=(await db.query('SELECT revision FROM teeko_teacher_models WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!previous)fail('NOT_FOUND','模型配置不存在。',404);if(previous.revision!==expectedRevision)fail('STALE','模型配置已更新，请重新读取。');
  return model((await db.query('UPDATE teeko_teacher_models SET config=$2,revision=revision+1,updated_at=$3 WHERE id=$1 RETURNING *',[id,JSON.stringify(config),this.now()])).rows[0]);
 });}
 async createAgent(accountId:string,value:TeacherAgentInput):Promise<TeacherAgent>{return this.authorized(accountId,async db=>{
  const config=input(teacherAgentInputSchema,value);await lock(db);const now=this.now();return agent((await db.query('INSERT INTO teeko_teacher_agents(id,config,created_at,updated_at) VALUES($1,$2,$3,$3) RETURNING *',[randomUUID(),JSON.stringify(config),now])).rows[0]);
 });}
 async updateAgent(accountId:string,id:string,expectedRevision:number,value:TeacherAgentInput):Promise<TeacherAgent>{return this.authorized(accountId,async db=>{
  identifier(id);revision(expectedRevision);const config=input(teacherAgentInputSchema,value);await lock(db);
  const previous=(await db.query('SELECT revision FROM teeko_teacher_agents WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!previous)fail('NOT_FOUND','智能体不存在。',404);if(previous.revision!==expectedRevision)fail('STALE','智能体已更新，请重新读取。');
  return agent((await db.query('UPDATE teeko_teacher_agents SET config=$2,revision=revision+1,updated_at=$3 WHERE id=$1 RETURNING *',[id,JSON.stringify(config),this.now()])).rows[0]);
 });}
 async publishAgent(accountId:string,id:string,expectedRevision:number):Promise<TeacherRelease>{return this.authorized(accountId,async db=>{
  identifier(id);revision(expectedRevision);await lock(db);
  const row=(await db.query('SELECT * FROM teeko_teacher_agents WHERE id=$1 FOR UPDATE',[id])).rows[0] as ConfigRow|undefined;if(!row)fail('NOT_FOUND','智能体不存在。',404);if(row.revision!==expectedRevision)fail('STALE','智能体已更新，请先保存并重新读取。');
  const version=Number((await db.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM teeko_teacher_releases WHERE agent_id=$1',[id])).rows[0].version);
  return insertRelease(db,agent(row),id,version,this.now(),accountId);
 });}
 async activateRelease(accountId:string,id:string):Promise<TeacherRelease>{return this.authorized(accountId,async db=>{
  identifier(id);await lock(db);const row=(await db.query('SELECT * FROM teeko_teacher_releases WHERE id=$1',[id])).rows[0] as ReleaseRow|undefined;if(!row)fail('NOT_FOUND','发布版本不存在。',404);
  await db.query('INSERT INTO teeko_teacher_active(singleton,release_id,updated_at) VALUES(true,$1,$2) ON CONFLICT(singleton) DO UPDATE SET release_id=EXCLUDED.release_id,updated_at=EXCLUDED.updated_at',[id,this.now()]);return release(row);
 });}
 async resolveDraft(accountId:string,value:TeacherAgentInput):Promise<FrozenTeacherConfig>{return this.authorized(accountId,async db=>{
  const config=input(teacherAgentInputSchema,value);await lock(db);return resolve(db,config,{id:randomUUID(),agentId:randomUUID(),agentName:config.name,version:0,publishedAt:this.now().toISOString()});
 });}
 async overview(accountId:string,days:number):Promise<AdminOverview>{return this.authorized(accountId,async db=>{
  if(days!==7&&days!==30)fail('INVALID_INPUT','统计范围仅支持最近7天或30天。',400);
  const today=new Date(this.now().getTime()+8*3600000).toISOString().slice(0,10),from=new Date(Date.parse(`${today}T00:00:00+08:00`)-(days-1)*86400000),dayKey=new Date(from.getTime()+8*3600000).toISOString().slice(0,10);
  const accounts=(await db.query('SELECT count(*)::int registered,count(*) FILTER(WHERE created_at >= $1 AND created_at <= $2)::int new FROM teeko_accounts',[from,this.now()])).rows[0];
  const profiles=Number((await db.query('SELECT count(*)::int count FROM teeko_profiles')).rows[0].count);
  const usage=(await db.query('SELECT count(DISTINCT account_id) FILTER(WHERE milliseconds>0)::int active,COALESCE(sum(milliseconds),0) AS milliseconds FROM teeko_classroom_usage WHERE day_key >= $1 AND day_key <= $2',[dayKey,today])).rows[0];
  const classrooms=(await db.query("SELECT count(*)::int classrooms,count(*) FILTER(WHERE status='ended')::int ended FROM teeko_classrooms WHERE started_at >= $1 AND started_at <= $2",[from,this.now()])).rows[0];
  const providerRows=(await db.query("SELECT preferences->>'provider' AS provider,count(*)::int classrooms,COALESCE(sum(elapsed_ms),0) milliseconds FROM teeko_classrooms WHERE started_at >= $1 AND started_at <= $2 GROUP BY preferences->>'provider'",[from,this.now()])).rows;
  const endings=(await db.query("SELECT end_reason AS reason,count(*)::int count FROM teeko_classrooms WHERE status='ended' AND ended_at >= $1 AND ended_at <= $2 GROUP BY end_reason ORDER BY end_reason",[from,this.now()])).rows;
  return {days,registeredUsers:accounts.registered,profiledUsers:profiles,newUsers:accounts.new,activeUsers:usage.active,classroomCount:classrooms.classrooms,endedCount:classrooms.ended,usageSeconds:Math.floor(Number(usage.milliseconds)/1000),providerUsage:(['qwen','openai'] as const).map(provider=>{const row=providerRows.find(row=>row.provider===provider);return {provider,seconds:Math.floor(Number(row?.milliseconds??0)/1000),classrooms:row?.classrooms??0};}),endings};
 });}
 async users(accountId:string,options:{page:number;pageSize:number}):Promise<AdminUsers>{return this.authorized(accountId,async db=>{
  const {page,pageSize}=options;if(!Number.isInteger(page)||page<0||page>100000||!Number.isInteger(pageSize)||pageSize<1||pageSize>50)fail('INVALID_INPUT','分页参数无效。',400);
  const total=Number((await db.query('SELECT count(*)::int count FROM teeko_accounts')).rows[0].count);
  const rows=(await db.query(`SELECT a.id,a.email,a.created_at,p.name,p.account_id IS NOT NULL AS profile_complete,COALESCE(c.classroom_count,0)::int AS classroom_count,c.last_classroom_at,COALESCE(u.milliseconds,0) AS milliseconds
   FROM teeko_accounts a LEFT JOIN teeko_profiles p ON p.account_id=a.id
   LEFT JOIN LATERAL(SELECT count(*) AS classroom_count,max(started_at) AS last_classroom_at FROM teeko_classrooms WHERE account_id=a.id)c ON true
   LEFT JOIN LATERAL(SELECT sum(milliseconds) AS milliseconds FROM teeko_classroom_usage WHERE account_id=a.id)u ON true
   ORDER BY a.created_at DESC,a.id LIMIT $1 OFFSET $2`,[pageSize,page*pageSize])).rows;
  return {total,page,pageSize,users:rows.map(row=>({id:row.id,email:row.email,name:row.name??null,createdAt:row.created_at.toISOString(),profileComplete:row.profile_complete,classroomCount:row.classroom_count,usageSeconds:Math.floor(Number(row.milliseconds)/1000),lastClassroomAt:row.last_classroom_at?.toISOString()??null}))};
 });}
}
