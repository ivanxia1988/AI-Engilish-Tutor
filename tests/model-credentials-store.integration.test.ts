import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {AdminService,initializeTeacherAgents} from '../lib/server/admin-service';
import {DEFAULT_TEACHER_MODELS} from '../lib/teacher-agent';
import {ModelCredentialsError,ModelCredentialsService} from '../lib/server/model-credentials';

const database=process.env.TEST_DATABASE_URL,secret='synthetic-model-protection-secret-at-least-32-bytes';
if(database){const url=new URL(database);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/test/.test(url.pathname))throw new Error('Use a loopback disposable test database.');}
const openai=DEFAULT_TEACHER_MODELS.find(entry=>entry.input.provider==='openai'&&entry.input.purpose==='reasoning')!;
const qwen=DEFAULT_TEACHER_MODELS.find(entry=>entry.input.provider==='qwen'&&entry.input.purpose==='reasoning')!;
const environment={OPENAI_API_KEY:'synthetic-environment-openai',DASHSCOPE_API_KEY:'synthetic-environment-qwen',DASHSCOPE_WORKSPACE_ID:'fixture-workspace',DASHSCOPE_REGION:'cn-beijing'};
async function fixture(t:TestContext,values:Record<string,string>={...environment}){
 const administrator=new Pool({connectionString:database}),schema=`model_credentials_test_${randomUUID().replaceAll('-','')}`;
 await administrator.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString:database,options:`-c search_path=${schema},public`,max:8});
 t.after(async()=>{await pool.end();await administrator.query(`DROP SCHEMA ${schema} CASCADE`);await administrator.end();});
 for(const file of ['0001_accounts.sql','0002_classrooms.sql','0003_teacher_agents.sql','0004_admin_auth.sql','0005_model_credentials.sql'])await pool.query(await readFile(new URL(`../db/migrations/${file}`,import.meta.url),'utf8'));
 await initializeTeacherAgents(pool);
 const owner=randomUUID(),other=randomUUID();
 for(const id of [owner,other])await pool.query("INSERT INTO teeko_accounts(id,email,password_hash,consent_version,consented_at,created_at) VALUES($1,$2,'synthetic','fixture',now(),now())",[id,`${id}@example.test`]);
 const admin=new AdminService(pool);await admin.grantAdmin(owner);
 const service=new ModelCredentialsService(pool,{secret,environment:name=>values[name],now:()=>new Date('2026-11-01T00:00:00Z')});
 return{pool,service,admin,owner,other,values};
}
const rejects=(promise:Promise<unknown>,code:string)=>assert.rejects(promise,error=>error instanceof ModelCredentialsError&&error.code===code);

test('encrypted model credentials remain private, permission bounded and dynamically resolved',{skip:!database},async t=>{
 await t.test('environment defaults are validated and status never returns credentials',async t=>{
  const f=await fixture(t);
  assert.deepEqual(await f.service.status(f.owner,openai.id),{provider:'openai',source:'environment',configured:true,revision:0,updatedAt:null});
  assert.deepEqual(await f.service.resolve({id:openai.id,provider:'openai'}),{apiKey:environment.OPENAI_API_KEY});
  assert.deepEqual(await f.service.resolve({id:qwen.id,provider:'qwen'}),{apiKey:environment.DASHSCOPE_API_KEY,workspaceId:environment.DASHSCOPE_WORKSPACE_ID,region:'cn-beijing'});
  const status=JSON.stringify(await f.service.status(f.owner,qwen.id));assert(!status.includes(environment.DASHSCOPE_API_KEY));assert(!status.includes('workspaceId'));
  delete f.values.DASHSCOPE_WORKSPACE_ID;assert.equal((await f.service.status(f.owner,qwen.id)).configured,false);await rejects(f.service.resolve({id:qwen.id,provider:'qwen'}),'CREDENTIALS_UNAVAILABLE');
 });
 await t.test('per-model encrypted overrides survive another service instance and use a fresh nonce on replacement',async t=>{
  const f=await fixture(t,{...environment});
  const input={provider:'openai' as const,expectedRevision:0,apiKey:'synthetic-custom-openai'};
  const saved=await f.service.set(f.owner,openai.id,input);assert.equal(saved.revision,1);assert.equal(saved.source,'model');assert.equal(saved.configured,true);assert(!JSON.stringify(saved).includes(input.apiKey));
  const first=(await f.pool.query('SELECT * FROM teeko_model_credentials WHERE model_id=$1',[openai.id])).rows[0];
  assert(Buffer.isBuffer(first.ciphertext));assert(!first.ciphertext.toString('utf8').includes(input.apiKey));assert.equal(first.nonce.length,12);assert.equal(first.auth_tag.length,16);
  const another=new ModelCredentialsService(f.pool,{secret,environment:name=>f.values[name]});
  assert.deepEqual(await another.resolve({id:openai.id,provider:'openai'}),{apiKey:input.apiKey});
  await f.service.set(f.owner,openai.id,{...input,expectedRevision:1});
  const second=(await f.pool.query('SELECT nonce FROM teeko_model_credentials WHERE model_id=$1',[openai.id])).rows[0];assert(!first.nonce.equals(second.nonce));
  assert.equal((await f.service.status(f.owner,DEFAULT_TEACHER_MODELS[1].id)).source,'environment');
 });
 await t.test('tampering, wrong protection key, cross-model and cross-provider copies never fall back to environment',async t=>{
  const f=await fixture(t,{...environment});await f.service.set(f.owner,openai.id,{provider:'openai',expectedRevision:0,apiKey:'synthetic-custom-openai'});
  const bad=new ModelCredentialsService(f.pool,{secret:'another-synthetic-protection-secret-at-least-32-bytes',environment:name=>f.values[name]});
  await rejects(bad.resolve({id:openai.id,provider:'openai'}),'CREDENTIALS_UNAVAILABLE');assert.equal((await bad.status(f.owner,openai.id)).configured,false);
  const target=DEFAULT_TEACHER_MODELS[1].id;
  await f.pool.query('INSERT INTO teeko_model_credentials(model_id,provider,revision,ciphertext,nonce,auth_tag,updated_at) SELECT $1,provider,revision,ciphertext,nonce,auth_tag,updated_at FROM teeko_model_credentials WHERE model_id=$2',[target,openai.id]);
  await rejects(f.service.resolve({id:target,provider:'openai'}),'CREDENTIALS_UNAVAILABLE');
  await rejects(f.service.resolve({id:openai.id,provider:'qwen'}),'CREDENTIALS_UNAVAILABLE');
  await f.pool.query("UPDATE teeko_model_credentials SET ciphertext=set_byte(ciphertext,0,(get_byte(ciphertext,0)+1)%256) WHERE model_id=$1",[openai.id]);
  await rejects(f.service.resolve({id:openai.id,provider:'openai'}),'CREDENTIALS_UNAVAILABLE');
 });
 await t.test('only administrators can read status or replace credentials, and provider changes require an explicit matching write',async t=>{
  const f=await fixture(t,{...environment});
  await rejects(f.service.status(f.other,openai.id),'FORBIDDEN');
  await rejects(f.service.set(f.other,openai.id,{provider:'openai',expectedRevision:0,apiKey:'synthetic-custom-openai'}),'FORBIDDEN');
  await rejects(f.service.importDefaults(f.other),'FORBIDDEN');
  await rejects(f.service.set(f.owner,qwen.id,{provider:'openai',expectedRevision:0,apiKey:'synthetic-custom-openai'}),'PROVIDER_MISMATCH');
  await f.service.set(f.owner,openai.id,{provider:'openai',expectedRevision:0,apiKey:'synthetic-custom-openai'});
  await f.admin.updateModel(f.owner,openai.id,1,{name:'Changed provider',provider:'qwen',purpose:'reasoning',model:'qwen-plus',enabled:true});
  assert.equal((await f.service.status(f.owner,openai.id)).configured,false);
  await rejects(f.service.resolve({id:openai.id,provider:'qwen'}),'CREDENTIALS_UNAVAILABLE');
  await f.service.set(f.owner,openai.id,{provider:'qwen',expectedRevision:1,apiKey:'synthetic-custom-qwen',workspaceId:'fixture-new-space',region:'ap-southeast-1'});
  assert.equal((await f.service.resolve({id:openai.id,provider:'qwen'})).workspaceId,'fixture-new-space');
  await f.admin.revokeAdmin(f.owner);await rejects(f.service.reset(f.owner,openai.id,{provider:'qwen',expectedRevision:2}),'FORBIDDEN');
 });
 await t.test('first writes serialize and stale replacements cannot win silently',async t=>{
  const f=await fixture(t,{...environment});
  const writes=await Promise.allSettled(['synthetic-first-key','synthetic-second-key'].map(apiKey=>f.service.set(f.owner,openai.id,{provider:'openai',expectedRevision:0,apiKey})));
  assert.equal(writes.filter(value=>value.status==='fulfilled').length,1);
  const failed=writes.find(value=>value.status==='rejected');assert(failed?.status==='rejected'&&failed.reason instanceof ModelCredentialsError&&failed.reason.code==='STALE');
  assert.equal((await f.service.status(f.owner,openai.id)).revision,1);
 });
 await t.test('reset retains a revision tombstone and subsequent import never restores removed overrides',async t=>{
  const f=await fixture(t,{...environment});assert.equal(await f.service.importDefaults(f.owner),5);assert.equal(await f.service.importDefaults(f.owner),0);
  await f.service.set(f.owner,openai.id,{provider:'openai',expectedRevision:1,apiKey:'synthetic-custom-openai'});
  const reset=await f.service.reset(f.owner,openai.id,{provider:'openai',expectedRevision:2});assert.equal(reset.revision,3);assert.equal(reset.source,'environment');assert.equal(reset.configured,true);
  await rejects(f.service.set(f.owner,openai.id,{provider:'openai',expectedRevision:2,apiKey:'synthetic-stale-key'}),'STALE');
  const row=(await f.pool.query('SELECT ciphertext,nonce,auth_tag FROM teeko_model_credentials WHERE model_id=$1',[openai.id])).rows[0];assert.deepEqual(row,{ciphertext:null,nonce:null,auth_tag:null});
  assert.equal(await f.service.importDefaults(f.owner),0);assert.equal((await f.service.status(f.owner,openai.id)).revision,3);assert.equal((await f.service.resolve({id:openai.id,provider:'openai'})).apiKey,environment.OPENAI_API_KEY);
  delete f.values.OPENAI_API_KEY;assert.equal((await f.service.status(f.owner,openai.id)).source,'missing');await rejects(f.service.resolve({id:openai.id,provider:'openai'}),'CREDENTIALS_UNAVAILABLE');
 });
});
