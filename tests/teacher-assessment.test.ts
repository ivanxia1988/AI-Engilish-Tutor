import test from 'node:test';
import assert from 'node:assert/strict';
import {createTeacherAssessment} from '../lib/server/teacher-assessment';
import {teacherConfig,teacherSnapshot} from './teacher-runtime-fixture';
const result={decision:'correct',confidence:'high',reason:'The learner expressed a valid thing to bring.',suggestedResponse:'Sandwiches sound great. Who would you share them with?',nextAction:'follow_up'};
const openai=(value:unknown)=>Response.json({status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
test('OpenAI assessment uses only bounded current text, strict JSON schema and no stored response',async()=>{
 let body:Record<string,unknown>|undefined;
 const assess=createTeacherAssessment({provider:'openai',apiKey:'synthetic-fixture',model:'gpt-4.1-mini',fetch:async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(String(init?.body));return openai(result);}});
 const snapshot=teacherSnapshot({stepIndex:8,preferences:{...teacherSnapshot().preferences,provider:'openai'}});
 assert.deepEqual(await assess({snapshot,config:teacherConfig,text:'I will bring sandwiches.'}),result);
 assert.equal(body?.store,false);assert.equal((body?.text as {format:{type:string}}).format.type,'json_schema');
 const sent=JSON.stringify(body);assert(sent.includes('sandwiches'));assert(!sent.includes('Synthetic learner'));assert(!sent.includes('data:image'));assert(!sent.includes('synthetic-fixture'));
});
test('Qwen assessment stays in its provider route and uses JSON mode with thinking disabled',async()=>{
 const assess=createTeacherAssessment({provider:'qwen',apiKey:'synthetic-fixture',workspaceId:'fixture-space',region:'cn-beijing',model:'qwen-plus',fetch:async(url,init)=>{assert.equal(url,'https://fixture-space.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');const body=JSON.parse(String(init?.body));assert.equal(body.enable_thinking,false);assert.equal(body.response_format.type,'json_object');assert(JSON.stringify(body.messages).includes('JSON'));return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result)}}]});}});
 assert.deepEqual(await assess({snapshot:teacherSnapshot(),config:teacherConfig,text:'It is an apple.'}),result);
});
test('malformed, refused and overlong model results are unavailable rather than invented grades',async()=>{
 for(const value of [{...result,decision:'mastered'}, {...result,unknown:true},{...result,reason:'x'.repeat(301)}]){
  const assess=createTeacherAssessment({provider:'openai',apiKey:'synthetic-fixture',model:'gpt-4.1-mini',fetch:async()=>openai(value)});
  await assert.rejects(assess({snapshot:teacherSnapshot({preferences:{...teacherSnapshot().preferences,provider:'openai'}}),config:teacherConfig,text:'apple'}),/教学判断/);
 }
});
test('a pre-aborted, hanging and oversized assessment cannot retain an unbounded request',async()=>{
 const input={snapshot:teacherSnapshot({preferences:{...teacherSnapshot().preferences,provider:'openai'}}),config:teacherConfig,text:'apple'};
 const signal=AbortSignal.abort();let called=0;
 const assess=createTeacherAssessment({provider:'openai',apiKey:'synthetic-fixture',model:'gpt-4.1-mini',timeoutMs:10,fetch:async()=>{called++;return new Promise<Response>(()=>{});}});
 await assert.rejects(assess(input,signal));assert.equal(called,0);await assert.rejects(assess(input),/教学判断/);
 const large=createTeacherAssessment({provider:'openai',apiKey:'synthetic-fixture',model:'gpt-4.1-mini',fetch:async()=>new Response('x'.repeat(33000))});await assert.rejects(large(input));
});
