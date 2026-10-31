import test from 'node:test';
import assert from 'node:assert/strict';

test('formal classroom API authenticates, enforces same origin, validates actions and never trusts ownership input',async()=>{
  const {createClassroomHandler}=await import('../lib/server/classroom-http.ts');
  const calls:unknown[]=[];let signedIn=true;
  const handler=createClassroomHandler({origin:'http://127.0.0.1:8080',authenticate:async()=>signedIn?{id:'owner',profileComplete:true}:null,service:{
    courses:async(id:string)=>{calls.push(id);return {courses:[],activeClassroom:null};},
    preferences:async()=>({provider:'qwen',language:'bilingual',style:'gentle',voice:'female',soundEffects:true}),
    savePreferences:async()=>({}), get:async()=>({id:'classroom'}),create:async()=>({id:'new'}),action:async()=>({id:'saved'}),
  } as never,providers:()=>[{id:'qwen',name:'通义',configured:true}],limit:async()=>{}});
  const req=(path:string,body?:unknown,origin='http://127.0.0.1:8080')=>new Request(`http://127.0.0.1:8080/api/v1${path}`,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body),headers:{Origin:origin,'Content-Type':'application/json'}})});
  signedIn=false;assert.equal((await handler(req('/courses'))).status,401);
  signedIn=true;assert.equal((await handler(req('/courses'))).status,200);assert.deepEqual(calls,['owner']);
  assert.equal((await handler(req('/classrooms',{courseId:'picnic'},'https://outside.example'))).status,403);
  assert.equal((await handler(req('/classrooms',{courseId:'picnic',accountId:'someone-else'}))).status,400);
  const id='00000000-0000-4000-8000-000000000001';
  assert.equal((await handler(req(`/classrooms/${id}/actions`,{eventId:crypto.randomUUID(),expectedRevision:0,type:'select',objectIds:['apple'],correct:true}))).status,400);
  assert.equal((await handler(req(`/classrooms/${id}/actions`,{eventId:crypto.randomUUID(),expectedRevision:0,type:'select',objectIds:['apple']}))).status,200);
  assert.equal((await handler(req('/classrooms/not-a-uuid'))).status,404);
});
