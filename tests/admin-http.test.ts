import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../lib/server/admin-http';
import {DEFAULT_TEACHER_AGENT,DEFAULT_TEACHER_MODELS} from '../lib/teacher-agent';
import {AccountError} from '../lib/server/account-service';
import {adminProblem} from '../lib/server/admin-runtime';
const origin='http://127.0.0.1:8080';
test('known account rate limits keep 429 while unknown upstream errors stay private',async()=>{
 const error=adminProblem(new AccountError('RATE_LIMITED','操作太频繁，请稍后再试。',429));assert.equal(error?.status,429);
 assert.equal(adminProblem(new Error('PRIVATE_UPSTREAM')),null);
});
test('admin APIs require a real signed-in administrator and same-origin writes',async()=>{
 let user:{id:string}|null=null,admin=false,calls=0;
 const handler=createAdminHandler({origin,authenticate:async()=>user,providers:()=>({qwen:true,openai:true}),limit:async()=>{},service:{isAdmin:async()=>admin,config:async()=>{calls++;return{models:[],agents:[],releases:[],activeRelease:null};}} as never,preview:async()=>'',tryout:async()=>{throw new Error('not called');}});
 const req=(path='/config',body?:unknown,site=origin)=>new Request(`${origin}/api/v1/admin${path}`,body===undefined?{}:{method:'POST',headers:{origin:site,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await handler(req())).status,401);user={id:'owner'};
 assert.equal((await handler(req())).status,403);assert.equal(calls,0);admin=true;
 assert.equal((await handler(req())).status,200);assert.equal(calls,1);
 assert.equal((await handler(req('/models',DEFAULT_TEACHER_MODELS[0].input,'https://outside.test'))).status,403);
 admin=false;assert.equal((await handler(req())).status,403);
});
test('admin validates model fields, prompt size, revisions and forbids role-escalation endpoints',async()=>{
 let writes=0;
 const handler=createAdminHandler({origin,authenticate:async()=>({id:'owner'}),providers:()=>({qwen:true,openai:true}),limit:async()=>{},service:{isAdmin:async()=>true,createModel:async()=>{writes++;return{};}} as never,preview:async()=>'',tryout:async()=>{throw new Error('not called');}});
 const post=(path:string,body:unknown)=>handler(new Request(`${origin}/api/v1/admin${path}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}));
 assert.equal((await post('/models',{...DEFAULT_TEACHER_MODELS[0].input,apiKey:'fixture-not-real'})).status,400);assert.equal(writes,0);
 assert.equal((await post('/models',DEFAULT_TEACHER_MODELS[0].input)).status,200);assert.equal(writes,1);
 assert.equal((await post('/agents',{...DEFAULT_TEACHER_AGENT,systemPrompt:'x'.repeat(8001)})).status,400);
 assert.equal((await post('/agents/30000000-0000-4000-8000-000000000001/publish',{})).status,400);
 assert.equal((await post('/grant',{accountId:'someone'})).status,404);
 const r=await handler(new Request(`${origin}/api/v1/admin/overview?days=999`));assert.equal(r.status,400);
});
test('admin preview and tryout preserve synthetic input and never expose unexpected error details',async()=>{
 let previewed=0;
 const handler=createAdminHandler({origin,authenticate:async()=>({id:'owner'}),providers:()=>({qwen:true,openai:true}),limit:async()=>{},service:{isAdmin:async()=>true} as never,preview:async()=>{previewed++;return'assembled prompt';},tryout:async()=>{throw new Error('PRIVATE_UPSTREAM_SECRET');}});
 const body={agent:DEFAULT_TEACHER_AGENT,profile:{name:'Mia',ageRange:'10–11',level:'sentences'},preferences:{provider:'qwen',language:'bilingual',style:'gentle',voice:'female',soundEffects:false}};
 const post=(path:string,value:unknown)=>handler(new Request(`${origin}/api/v1/admin${path}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(value)}));
 assert.equal((await post('/preview',body)).status,200);assert.equal(previewed,1);
 const result=await post('/tryout',{...body,text:'I will bring sandwiches.',taskId:'pack-picnic'});assert.equal(result.status,503);assert(!(await result.text()).includes('PRIVATE'));
});
