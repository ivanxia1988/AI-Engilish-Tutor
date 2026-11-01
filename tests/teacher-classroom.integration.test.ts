import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {ClassroomService} from '../lib/server/classroom-service';
import {publishTrialCourses} from '../lib/server/course-catalog';
import {initializeTeacherAgents,AdminService} from '../lib/server/admin-service';
import type {TeacherAssessment} from '../lib/server/teacher-assessment';
const database=process.env.TEST_DATABASE_URL;
if(database){const url=new URL(database);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/test/.test(url.pathname))throw new Error('Loopback disposable test database required.');}
async function fixture(t:TestContext,assess?:TeacherAssessment){
 const admin=new Pool({connectionString:database}),schema=`teacher_runtime_test_${randomUUID().replaceAll('-','')}`;await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString:database,options:`-c search_path=${schema},public`,max:8});
 t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
 for(const name of ['0001_accounts.sql','0002_classrooms.sql','0003_teacher_agents.sql'])await pool.query(await readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8'));
 await publishTrialCourses(pool);await initializeTeacherAgents(pool);const owner=randomUUID();
 await pool.query("INSERT INTO teeko_accounts(id,email,password_hash,consent_version,consented_at,created_at)VALUES($1,$2,'synthetic','v1',now(),now())",[owner,`${owner}@example.test`]);
 await pool.query("INSERT INTO teeko_profiles(account_id,name,age_range,level,updated_at)VALUES($1,'Synthetic','10–11','starter',now())",[owner]);
 const service=new ClassroomService(pool,{assess}),settings=new AdminService(pool);await settings.grantAdmin(owner);
 return{pool,service,settings,owner};
}
const response={decision:'correct' as const,confidence:'high' as const,reason:'The learner expressed what to bring.',suggestedResponse:'Sandwiches sound great!',nextAction:'acknowledge' as const};
async function speaking(f:Awaited<ReturnType<typeof fixture>>){const created=await f.service.create(f.owner,'picnic');await f.pool.query('UPDATE teeko_classrooms SET step_index=8 WHERE id=$1',[created.id]);const lease=await f.service.claim(f.owner,created.id);return{...lease,id:created.id,key:`${created.id}:${lease.epoch}:8`};}
test('classroom freezes published teacher models and prompt, without exposing the private config',{skip:!database},async t=>{
 const f=await fixture(t);const created=await f.service.create(f.owner,'picnic');const before=await f.service.teacherRuntime(f.owner,created.id);
 assert(before.config?.systemPrompt);assert.equal(before.config?.routes.qwen?.realtime.model,'qwen3.8-omni-flash-realtime');
 assert(!JSON.stringify(created).includes('systemPrompt'));
 const config=await f.settings.config(f.owner),agent=config.agents[0];
 const {id:_id,revision:_revision,createdAt:_created,updatedAt:_updated,...input}=agent;void _id;void _revision;void _created;void _updated;
 await f.settings.updateAgent(f.owner,agent.id,agent.revision,{...input,systemPrompt:'A different synthetic teacher prompt with different instructions.'});
 const after=await f.service.teacherRuntime(f.owner,created.id);assert.deepEqual(after.config,before.config);
});
test('semantic expressions progress once; low confidence and provider failures never fabricate correctness',{skip:!database},async t=>{
 let count=0;const f=await fixture(t,async()=>{count++;return response;});const c=await speaking(f);
 const event={role:'child' as const,final:true,text:'I will bring sandwiches.',itemId:'sandwiches',contextKey:c.key};
 await Promise.all([f.service.receiveTranscript(f.owner,c.id,c.epoch,c.ownerToken,event),f.service.receiveTranscript(f.owner,c.id,c.epoch,c.ownerToken,event)]);
 const state=await f.service.get(f.owner,c.id);assert.equal(count,1);assert.equal(state.stepIndex,9);assert.equal(state.status,'active');assert.equal(state.outcomes.length,1);
 const decisions=await f.pool.query('SELECT count(*)::int AS count FROM teeko_teaching_decisions WHERE classroom_id=$1',[c.id]);assert.equal(decisions.rows[0].count,1);
});
test('assessment runs outside locks; a new task makes the old result obsolete',{skip:!database},async t=>{
 let started:()=>void=()=>{},finish:(value:typeof response)=>void=()=>{};const pending=new Promise<void>(r=>{started=r;});
 const f=await fixture(t,async()=>{started();return new Promise(resolve=>{finish=resolve;});});const c=await speaking(f);
 const work=f.service.receiveTranscript(f.owner,c.id,c.epoch,c.ownerToken,{role:'child',final:true,text:'I will bring water.',itemId:'water',contextKey:c.key});await pending;
 const state=await Promise.race([f.service.get(f.owner,c.id),new Promise<never>((_r,reject)=>setTimeout(()=>reject(new Error('Assessment held a database lock.')),500))]);
 await f.service.action(f.owner,c.id,{eventId:randomUUID(),expectedRevision:state.revision,type:'skip'});finish(response);await work;
 const after=await f.service.get(f.owner,c.id);assert.equal(after.stepIndex,9);assert.deepEqual(after.outcomes.map(x=>x.status),['skipped']);
});
test('revoked authorization, a newer utterance and uncertain results do not consume the old answer',{skip:!database},async t=>{
 let authorize=true,finish:(value:typeof response)=>void=()=>{},started:()=>void=()=>{};const pending=new Promise<void>(r=>{started=r;});
 const f=await fixture(t,async()=>{started();return new Promise(resolve=>{finish=resolve;});});const c=await speaking(f);
 const work=f.service.receiveTranscript(f.owner,c.id,c.epoch,c.ownerToken,{role:'child',final:true,text:'I will bring water.',itemId:'old',contextKey:c.key},async()=>authorize);await pending;
 authorize=false;finish(response);await work;assert.equal((await f.service.get(f.owner,c.id)).stepIndex,8);
});
test('a newer complete utterance invalidates old semantic credit even on the same task',{skip:!database},async t=>{
 let finish:(value:typeof response)=>void=()=>{},started:()=>void=()=>{};const pending=new Promise<void>(r=>{started=r;});
 const f=await fixture(t,async()=>{started();return new Promise(resolve=>{finish=resolve;});});const c=await speaking(f);
 const work=f.service.receiveTranscript(f.owner,c.id,c.epoch,c.ownerToken,{role:'child',final:true,text:'I will bring water.',itemId:'older',contextKey:c.key});await pending;
 await f.service.transcript(f.owner,c.id,c.epoch,c.ownerToken,{role:'child',final:true,text:'Wait, I want to talk about dinosaurs.',itemId:'newer',contextKey:c.key});
 finish(response);await work;const state=await f.service.get(f.owner,c.id);assert.equal(state.stepIndex,8);assert.equal(state.outcomes.length,0);
});
test('low-confidence and unavailable semantic decisions keep unknown expressions ungraded',{skip:!database},async t=>{
 for(const mode of ['uncertain','failed'] as const){
  const f=await fixture(t,async()=>{if(mode==='failed')throw new Error('synthetic unavailable');return{...response,confidence:'low'};});const c=await speaking(f);
  await f.service.receiveTranscript(f.owner,c.id,c.epoch,c.ownerToken,{role:'child',final:true,text:'I will bring water.',itemId:mode,contextKey:c.key});
  const state=await f.service.get(f.owner,c.id),teaching=await f.service.teacherRuntime(f.owner,c.id);assert.equal(state.stepIndex,8);assert.equal(state.outcomes.length,0);assert.deepEqual(teaching.state.evidence,[]);
 }
});
test('one learner turn cannot repeatedly consume hint or adaptation budgets through tool retries',{skip:!database},async t=>{
 let count=0;const f=await fixture(t,async()=>{count++;return{...response,decision:'retry',nextAction:'hint'};});const c=await speaking(f);
 await f.service.receiveTranscript(f.owner,c.id,c.epoch,c.ownerToken,{role:'child',final:true,text:'I like apples.',itemId:'attempt-one',contextKey:c.key});
 await f.service.tool(f.owner,c.id,c.epoch,c.ownerToken,'submit_spoken_answer',{contextKey:c.key,answer:'I like apples.'});
 const teaching=await f.service.teacherRuntime(f.owner,c.id);assert.equal(count,1);assert.equal(teaching.state.hints['pack-picnic'],1);assert.equal(teaching.state.evidence.length,1);
});
test('semantic assessment judges stored learner evidence instead of trusting the tool answer echo',{skip:!database},async t=>{
 const f=await fixture(t,async()=>response);const c=await speaking(f);
 await f.service.transcript(f.owner,c.id,c.epoch,c.ownerToken,{role:'child',final:true,text:'I will bring sandwiches.',itemId:'actual-evidence',contextKey:c.key});
 const result=await f.service.tool(f.owner,c.id,c.epoch,c.ownerToken,'submit_spoken_answer',{contextKey:c.key,answer:'the tool echoed something else'});
 assert.equal(result.snapshot.stepIndex,9);assert.equal(result.snapshot.outcomes.length,1);
});
test('semantic assessment receives the adapted classroom support state',{skip:!database},async t=>{
 let received:Parameters<TeacherAssessment>[0]|undefined;
 const f=await fixture(t,async input=>{received=input;return response;}),c=await speaking(f);
 await f.pool.query("UPDATE teeko_classrooms SET teaching_state=$2 WHERE id=$1",[c.id,JSON.stringify({level:'sentences',evidence:['independent'],hints:{},digressionTurns:0})]);
 await f.service.receiveTranscript(f.owner,c.id,c.epoch,c.ownerToken,{role:'child',final:true,text:'I will bring sandwiches.',itemId:'adapted',contextKey:c.key});
 assert.equal(received?.snapshot.profile.level,'starter');assert.equal(received?.teachingState?.level,'sentences');
});
test('normal expressions mentioning circles or highlights reach semantic assessment for transcript and delegate paths',{skip:!database},async t=>{
 for(const name of ['submit_spoken_answer','delegate'])for(const text of ['I will bring circle-shaped sandwiches.','The highlight of my picnic will be sandwiches.','我会带圈圈形的三明治。']){
  let count=0;const f=await fixture(t,async()=>{count++;return response;}),c=await speaking(f);
  await f.service.transcript(f.owner,c.id,c.epoch,c.ownerToken,{role:'child',final:true,text,itemId:'normal-expression',contextKey:c.key});
  const state=await f.service.tool(f.owner,c.id,c.epoch,c.ownerToken,name,{contextKey:c.key,answer:text});
  assert.equal(count,1,text);assert.equal(state.snapshot.stepIndex,9,text);assert.deepEqual(state.snapshot.teacherObjectIds,[]);
 }
});
test('explicit annotation requests still highlight the object instead of becoming assessed answers',{skip:!database},async t=>{
 for(const text of ['Circle the apple.','Please highlight the banana.','Can you circle the apple, please?','请帮我圈出苹果。']){
  let count=0;const f=await fixture(t,async()=>{count++;return response;}),c=await speaking(f);
  await f.service.transcript(f.owner,c.id,c.epoch,c.ownerToken,{role:'child',final:true,text,itemId:'annotation',contextKey:c.key});
  const state=await f.service.tool(f.owner,c.id,c.epoch,c.ownerToken,'delegate',{contextKey:c.key});
  assert.equal(count,0,text);assert.equal(state.snapshot.stepIndex,8,text);assert.equal(state.output.status,'confirmed',text);assert.equal(state.snapshot.teacherObjectIds.length,1,text);
 }
});
