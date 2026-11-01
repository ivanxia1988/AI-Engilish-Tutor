import test from 'node:test';
import assert from 'node:assert/strict';
import {createTeacherAssessment} from '../lib/server/teacher-assessment';
import {teacherConfig,teacherSnapshot} from './teacher-runtime-fixture';

test('real teaching models distinguish open answers, unrelated interests and a named object', {skip:process.env.TEEKO_TEACHER_LIVE_SMOKE!=='1',timeout:60000}, async()=>{
 for(const provider of ['qwen','openai'] as const){
  const apiKey=process.env[provider==='qwen'?'DASHSCOPE_API_KEY':'OPENAI_API_KEY'];assert(apiKey,'Configure provider credentials through the environment.');
  const assess=createTeacherAssessment({provider,apiKey,model:provider==='qwen'?'qwen-plus':'gpt-4.1-mini',workspaceId:process.env.DASHSCOPE_WORKSPACE_ID,region:process.env.DASHSCOPE_REGION});
  const examples=[
   {stepIndex:8,text:'I will bring sandwiches.',decision:'correct'},
   {stepIndex:6,text:'I like dinosaurs.',decision:'conversation'},
   {stepIndex:1,text:'It is an apple.',decision:'correct'},
  ];
  for(const example of examples){
   const snapshot=teacherSnapshot({stepIndex:example.stepIndex,preferences:{...teacherSnapshot().preferences,provider}});
   const result=await assess({snapshot,config:teacherConfig,text:example.text});
   assert.equal(result.decision,example.decision,`${provider}, activity ${example.stepIndex}`);
   assert.equal(result.confidence,'high',`${provider}, activity ${example.stepIndex}`);
  }
 }
});
