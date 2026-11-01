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
 const reference=JSON.parse((body!.input as {content:{text:string}[]}[])[0].content[0].text.replace('Untrusted classroom reference JSON: ',''));
 assert.equal(reference.task.answerScope,'open_expression');assert.equal(reference.task.expected,undefined);assert.equal(reference.knownObjects,undefined);
});
test('Qwen assessment stays in its provider route and uses JSON mode with thinking disabled',async()=>{
 const assess=createTeacherAssessment({provider:'qwen',apiKey:'synthetic-fixture',workspaceId:'fixture-space',region:'cn-beijing',model:'qwen-plus',fetch:async(url,init)=>{assert.equal(url,'https://fixture-space.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');const body=JSON.parse(String(init?.body));assert.equal(body.enable_thinking,false);assert.equal(body.response_format.type,'json_object');const messages=JSON.stringify(body.messages);assert(messages.includes('JSON'));assert(messages.includes('confidence'));assert(messages.includes('high'));assert(messages.includes('low'));assert(messages.includes('maxLength'));assert(messages.includes('additionalProperties'));return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result)}}]});}});
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
test('assessment pacing follows the adapted activity level while retaining the initial profile level',async()=>{
 let reference:Record<string,unknown>|undefined;
 const assess=createTeacherAssessment({provider:'openai',apiKey:'synthetic-fixture',model:'gpt-4.1-mini',fetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));reference=JSON.parse(body.input[0].content[0].text.replace('Untrusted classroom reference JSON: ',''));return openai(result);
 }});
 const snapshot=teacherSnapshot({profile:{...teacherSnapshot().profile,level:'conversation'},preferences:{...teacherSnapshot().preferences,provider:'openai'}});
 await assess({snapshot,config:teacherConfig,text:'I will bring sandwiches.',teachingState:{level:'starter',evidence:[],hints:{},digressionTurns:0}});
 assert.equal(reference?.initialLevel,'conversation');assert.equal(reference?.effectiveLevel,'starter');assert.deepEqual(reference?.policy,teacherConfig.policy.levels.starter);
 await assess({snapshot,config:teacherConfig,text:'I will bring sandwiches.'});
 assert.equal(reference?.effectiveLevel,'conversation');assert.deepEqual(reference?.policy,teacherConfig.policy.levels.conversation);
});

test('assessment receives the actual conversation policy before proposing a bridge',async()=>{
 let reference:{digression:{mayInviteBridge:boolean;exchanges:number}}|undefined;
 const assess=createTeacherAssessment({provider:'openai',apiKey:'synthetic-fixture',model:'gpt-4.1-mini',fetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));reference=JSON.parse(body.input[0].content[0].text.replace('Untrusted classroom reference JSON: ',''));return openai({...result,decision:'conversation',nextAction:'continue_topic'});
 }});
 const snapshot=teacherSnapshot({preferences:{...teacherSnapshot().preferences,provider:'openai'}});
 await assess({snapshot,config:teacherConfig,text:'I like dinosaurs.'});assert.equal(reference?.digression.mayInviteBridge,false);
 await assess({snapshot,config:teacherConfig,text:'I like dinosaurs.',teachingState:{level:'starter',evidence:[],hints:{},digressionTurns:3}});assert.equal(reference?.digression.exchanges,3);assert.equal(reference?.digression.mayInviteBridge,true);
 const config={...teacherConfig,policy:{...teacherConfig.policy,digression:'open' as const}};
 await assess({snapshot,config,text:'I like dinosaurs.',teachingState:{level:'starter',evidence:[],hints:{},digressionTurns:6}});assert.equal(reference?.digression.mayInviteBridge,false);
});
