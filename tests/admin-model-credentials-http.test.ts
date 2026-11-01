import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../lib/server/admin-http';
const origin='https://admin.teeko.app',id='20000000-0000-4000-8000-000000000001';
test('credential endpoints require admin origin and strict write-only input',async()=>{
 let signedIn=true,administrator=true,writes=0,resets=0;
 const status={provider:'qwen',source:'model',configured:true,revision:1,updatedAt:'2026-11-01T00:00:00Z'};
 const handler=createAdminHandler({origin,authenticate:async()=>signedIn?{id:'owner'}:null,service:{isAdmin:async()=>administrator} as never,providers:()=>({qwen:true,openai:true}),limit:async()=>{},preview:async()=>'',tryout:async()=>null,credentials:{status:async()=>status,set:async(_account:string,model:string,value:unknown)=>{assert.equal(model,id);assert.equal((value as {apiKey:string}).apiKey,'synthetic-private-key');writes++;return status;},reset:async()=>{resets++;return{...status,source:'environment'};}}} as never);
 const call=(path='',body?:unknown,site=origin)=>handler(new Request(`${origin}/api/v1/admin/models/${id}/credentials${path}`,{method:body?'POST':'GET',headers:{origin:site,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
 const get=await call();assert.equal(get.status,200);assert.deepEqual(await get.json(),{ok:true,credential:status});
 const body={provider:'qwen',expectedRevision:0,apiKey:'synthetic-private-key',workspaceId:'fixture-space',region:'cn-beijing'};
 const saved=await call('',body);assert.equal(saved.status,200);assert(!(await saved.text()).includes(body.apiKey));assert.equal(writes,1);
 assert.equal((await call('',{...body,endpoint:'https://outside.invalid'})).status,400);assert.equal(writes,1);
 assert.equal((await call('',body,'https://teeko.app')).status,403);assert.equal(writes,1);
 assert.equal((await call('/reset',{provider:'qwen',expectedRevision:1})).status,200);assert.equal(resets,1);
 administrator=false;assert.equal((await call('',body)).status,403);signedIn=false;assert.equal((await call()).status,401);assert.equal(writes,1);
});
