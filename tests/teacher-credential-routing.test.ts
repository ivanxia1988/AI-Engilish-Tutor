import test from 'node:test';
import assert from 'node:assert/strict';
import {createTeacherCredentialRoutes} from '../lib/server/teacher-credential-routing';
import {teacherConfig,teacherSnapshot} from './teacher-runtime-fixture';
test('each task resolves its own frozen model identity and voice captures a private configuration',async()=>{
 const calls:string[]=[];
 const routes=createTeacherCredentialRoutes(async model=>{calls.push(model.id);return{apiKey:`synthetic-${model.id}`,workspaceId:'fixture-space',region:'cn-beijing'};},name=>name==='OPENAI_CHILD_DATA_READY'?'true':undefined);
 const snapshot=teacherSnapshot({preferences:{...teacherSnapshot().preferences,provider:'openai'}});
 const voice=await routes.voice(snapshot,teacherConfig);assert.equal(voice.key,`synthetic-${teacherConfig.routes.openai!.realtime.id}`);assert.equal(voice.model,teacherConfig.routes.openai!.realtime.model);assert.equal(voice.voice,'gleam');
 const reasoning=await routes.forModel('openai','reasoning',teacherConfig.routes.openai!.reasoning);const vision=await routes.forModel('openai','vision',teacherConfig.routes.openai!.vision);
 assert.notEqual(reasoning.apiKey,vision.apiKey);assert.deepEqual(calls,[teacherConfig.routes.openai!.realtime.id,teacherConfig.routes.openai!.reasoning!.id,teacherConfig.routes.openai!.vision!.id]);assert(!JSON.stringify(snapshot).includes('synthetic-20000000'));
});
test('provider availability honors published routes, current credentials and OpenAI enablement',async()=>{
 const routes=createTeacherCredentialRoutes(async model=>{if(model.provider==='qwen')throw new Error('safe-unavailable');return{apiKey:'synthetic-fixture-key'};},()=>undefined);
 assert.deepEqual(await routes.availability(teacherConfig),{qwen:false,openai:false});
 const enabled=createTeacherCredentialRoutes(async()=>({apiKey:'synthetic-fixture-key'}),name=>name==='OPENAI_CHILD_DATA_READY'?'true':undefined);
 assert.deepEqual(await enabled.availability({...teacherConfig,routes:{...teacherConfig.routes,qwen:null}}),{qwen:false,openai:true});
 await assert.rejects(enabled.forModel('qwen','reasoning',teacherConfig.routes.openai!.reasoning));
});
