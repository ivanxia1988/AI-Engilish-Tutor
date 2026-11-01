import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {AdminService,AdminError,initializeTeacherAgents,resolvePublishedTeacher} from '../lib/server/admin-service';
import {DEFAULT_TEACHER_AGENT,DEFAULT_TEACHER_MODELS} from '../lib/teacher-agent';
import {publishTrialCourses} from '../lib/server/course-catalog';

const database=process.env.TEST_DATABASE_URL;
if(database){const url=new URL(database);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/test/.test(url.pathname))throw new Error('A loopback disposable test database is required.');}
async function fixture(t:TestContext){
 const admin=new Pool({connectionString:database}),schema=`admin_test_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString:database,options:`-c search_path=${schema},public`,max:8});
 t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
 for(const file of ['0001_accounts.sql','0002_classrooms.sql','0003_teacher_agents.sql'])await pool.query(await readFile(new URL(`../db/migrations/${file}`,import.meta.url),'utf8'));
 const owner=randomUUID(),other=randomUUID();
 for(const id of [owner,other])await pool.query("INSERT INTO teeko_accounts(id,email,password_hash,consent_version,consented_at,created_at) VALUES($1,$2,'synthetic','v1',now(),$3)",[id,`${id}@example.test`,new Date('2026-11-01T01:00:00Z')]);
 const service=new AdminService(pool,{now:()=>new Date('2026-11-01T02:00:00Z')});
 return {pool,service,owner,other};
}
const rejectsCode=(value:Promise<unknown>,code:string)=>assert.rejects(value,error=>error instanceof AdminError&&error.code===code);

test('admin config, publication and real usage are persistent and permission bounded',{skip:!database},async t=>{
 await t.test('seed is concurrent-idempotent and grants no implicit admin',async t=>{
  const f=await fixture(t);await Promise.all([initializeTeacherAgents(f.pool),initializeTeacherAgents(f.pool)]);
  assert.equal(await f.service.isAdmin(f.owner),false);await rejectsCode(f.service.config(f.owner),'FORBIDDEN');
  assert.equal((await f.pool.query('SELECT count(*)::int count FROM teeko_teacher_models')).rows[0].count,5);
  assert.equal((await f.pool.query('SELECT count(*)::int count FROM teeko_teacher_releases')).rows[0].count,1);
  assert((await resolvePublishedTeacher(f.pool))?.routes.qwen?.realtime.model);
  await f.service.grantAdmin(f.owner);assert.equal(await f.service.isAdmin(f.owner),true);assert.equal((await f.service.config(f.owner)).agents.length,1);
  await f.service.revokeAdmin(f.owner);await rejectsCode(f.service.config(f.owner),'FORBIDDEN');
 });
 await t.test('publication snapshots models and drafts, activates one release and supports immutable rollback',async t=>{
  const f=await fixture(t);await initializeTeacherAgents(f.pool);await f.service.grantAdmin(f.owner);
  const first=(await f.service.config(f.owner)).activeRelease!;
  const input={...structuredClone(DEFAULT_TEACHER_AGENT),name:'Another patient teacher'};
  const agent=await f.service.createAgent(f.owner,input),release=await f.service.publishAgent(f.owner,agent.id,agent.revision);
  const frozen=await resolvePublishedTeacher(f.pool);assert.equal(frozen?.id,release.id);assert.equal(frozen?.agentName,input.name);
  const model=DEFAULT_TEACHER_MODELS[0];await f.service.updateModel(f.owner,model.id,1,{...model.input,model:'qwen-fixture-revision-two'});
  await f.service.updateAgent(f.owner,agent.id,agent.revision,{...input,systemPrompt:'A completely different future teacher prompt with enough content.'});
  assert.deepEqual(await resolvePublishedTeacher(f.pool),frozen);
  await f.service.activateRelease(f.owner,first.id);assert.equal((await resolvePublishedTeacher(f.pool))?.id,first.id);
  const config=await f.service.config(f.owner);assert.equal(config.releases.length,2);assert.equal(config.activeRelease?.id,first.id);
 });
 await t.test('stale writes fail and cross-provider/wrong-purpose/disabled bindings never publish',async t=>{
  const f=await fixture(t);await initializeTeacherAgents(f.pool);await f.service.grantAdmin(f.owner);
  const agent=await f.service.createAgent(f.owner,DEFAULT_TEACHER_AGENT);
  const updates=await Promise.allSettled([f.service.updateAgent(f.owner,agent.id,1,{...DEFAULT_TEACHER_AGENT,name:'one'}),f.service.updateAgent(f.owner,agent.id,1,{...DEFAULT_TEACHER_AGENT,name:'two'})]);
  assert.equal(updates.filter(x=>x.status==='fulfilled').length,1);
  await rejectsCode(f.service.publishAgent(f.owner,agent.id,1),'STALE');
  const wrong=await f.service.createAgent(f.owner,{...DEFAULT_TEACHER_AGENT,routes:{...DEFAULT_TEACHER_AGENT.routes,qwen:{...DEFAULT_TEACHER_AGENT.routes.qwen,realtimeModelId:DEFAULT_TEACHER_MODELS[1].id}}});
  await rejectsCode(f.service.publishAgent(f.owner,wrong.id,1),'MODEL_BINDING');
  const wrongPurpose=await f.service.createAgent(f.owner,{...DEFAULT_TEACHER_AGENT,routes:{...DEFAULT_TEACHER_AGENT.routes,qwen:{...DEFAULT_TEACHER_AGENT.routes.qwen,realtimeModelId:DEFAULT_TEACHER_MODELS[2].id}}});
  await rejectsCode(f.service.publishAgent(f.owner,wrongPurpose.id,1),'MODEL_BINDING');
  const reasoning=await f.service.createModel(f.owner,{name:'Disabled reasoning',provider:'qwen',purpose:'reasoning',model:'qwen-plus',enabled:false});
  const disabled=await f.service.createAgent(f.owner,{...DEFAULT_TEACHER_AGENT,routes:{...DEFAULT_TEACHER_AGENT.routes,qwen:{...DEFAULT_TEACHER_AGENT.routes.qwen,reasoningModelId:reasoning.id}}});
  await rejectsCode(f.service.publishAgent(f.owner,disabled.id,1),'MODEL_BINDING');
  const inactive=await f.service.createAgent(f.owner,{...DEFAULT_TEACHER_AGENT,enabled:false});await rejectsCode(f.service.publishAgent(f.owner,inactive.id,1),'AGENT_DISABLED');
  await rejectsCode(f.service.createModel(f.other,DEFAULT_TEACHER_MODELS[0].input),'FORBIDDEN');
 });
 await t.test('concurrent publishes serialize versions and offline draft resolution cannot activate itself',async t=>{
  const f=await fixture(t);await initializeTeacherAgents(f.pool);await f.service.grantAdmin(f.owner);
  const first=await resolvePublishedTeacher(f.pool),agent=await f.service.createAgent(f.owner,{...DEFAULT_TEACHER_AGENT,name:'draft'});
  const draft=await f.service.resolveDraft(f.owner,{...DEFAULT_TEACHER_AGENT,name:'unpublished preview'});assert.equal(draft.agentName,'unpublished preview');assert.deepEqual(await resolvePublishedTeacher(f.pool),first);
  const published=await Promise.all([f.service.publishAgent(f.owner,agent.id,1),f.service.publishAgent(f.owner,agent.id,1)]);
  assert.equal(new Set(published.map(x=>x.version)).size,2);assert.equal((await f.pool.query('SELECT count(*)::int count FROM teeko_teacher_active')).rows[0].count,1);
 });
 await t.test('statistics use registered accounts and settled usage, Shanghai date window, bounded user pagination',async t=>{
  const f=await fixture(t);await initializeTeacherAgents(f.pool);await f.service.grantAdmin(f.owner);
  await f.pool.query("INSERT INTO teeko_profiles(account_id,name,age_range,level,updated_at) VALUES($1,'Synthetic learner','10–11','unsure',now())",[f.owner]);
  await f.pool.query("INSERT INTO teeko_classroom_usage(account_id,day_key,milliseconds) VALUES($1,'2026-11-01',90000),($2,'2026-10-01',180000)",[f.owner,f.other]);
  const overview=await f.service.overview(f.owner,7);
  assert.equal(overview.registeredUsers,2);assert.equal(overview.profiledUsers,1);assert.equal(overview.activeUsers,1);assert.equal(overview.usageSeconds,90);assert.equal(overview.newUsers,2);
  const users=await f.service.users(f.owner,{page:0,pageSize:1});assert.equal(users.total,2);assert.equal(users.users.length,1);assert(!JSON.stringify(users).includes('password_hash'));
  await rejectsCode(f.service.users(f.owner,{page:0,pageSize:51}),'INVALID_INPUT');await rejectsCode(f.service.overview(f.other,7),'FORBIDDEN');
  await f.service.revokeAdmin(f.owner);await rejectsCode(f.service.users(f.owner,{page:0,pageSize:10}),'FORBIDDEN');
 });
 await t.test('usage window starts at Shanghai midnight and provider totals count logical classrooms, not reconnects',async t=>{
  const f=await fixture(t);await initializeTeacherAgents(f.pool);await f.service.grantAdmin(f.owner);await publishTrialCourses(f.pool);
  const course=(await f.pool.query("SELECT version FROM teeko_courses WHERE id='picnic' ORDER BY published_at DESC LIMIT 1")).rows[0].version;
  const insert=async(start:string,provider:string,milliseconds:number,ended:string)=>f.pool.query(`INSERT INTO teeko_classrooms(id,account_id,course_id,course_version,profile,preferences,status,max_ms,started_at,day_key,ended_at,end_reason,elapsed_ms,connection_epoch) VALUES($1,$2,'picnic',$3,'{}',$4,'ended',900000,$5,'2026-10-26',$6,'manual',$7,9)`,[randomUUID(),f.owner,course,JSON.stringify({provider}),new Date(start),new Date(ended),milliseconds]);
  await insert('2026-10-25T16:00:00Z','qwen',45000,'2026-10-26T00:01:00Z');
  await insert('2026-10-25T15:59:59Z','openai',20000,'2026-10-26T00:01:00Z');
  await f.pool.query("INSERT INTO teeko_classroom_usage(account_id,day_key,milliseconds) VALUES($1,'2026-10-25',180000),($1,'2026-10-26',40000),($1,'2026-11-01',90000)",[f.owner]);
  const stats=await f.service.overview(f.owner,7);
  assert.equal(stats.usageSeconds,130);assert.equal(stats.activeUsers,1);assert.equal(stats.classroomCount,1);assert.equal(stats.endedCount,1);
  assert.deepEqual(stats.providerUsage,[{provider:'qwen',seconds:45,classrooms:1},{provider:'openai',seconds:0,classrooms:0}]);
  assert.deepEqual(stats.endings,[{reason:'manual',count:2}]);
 });
});
