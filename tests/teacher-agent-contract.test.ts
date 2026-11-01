import test from 'node:test';
import assert from 'node:assert/strict';
import {teacherModelInputSchema,teacherAgentInputSchema,DEFAULT_TEACHER_AGENT,DEFAULT_TEACHER_MODELS} from '../lib/teacher-agent';
test('teacher defaults provide separate same-provider model routes and bounded level policies',()=>{
 const agent=teacherAgentInputSchema.parse(DEFAULT_TEACHER_AGENT);
 assert(agent.policy.levels.starter.maxWordsPerSentence<agent.policy.levels.conversation.maxWordsPerSentence);
 assert.equal(DEFAULT_TEACHER_MODELS.length,5);
 assert(agent.routes.qwen.realtimeModelId);assert(agent.routes.openai.realtimeModelId);
});
test('model configuration rejects credentials, arbitrary fields and invalid kinds',()=>{
 const model=DEFAULT_TEACHER_MODELS[0];
 assert(teacherModelInputSchema.safeParse(model.input).success);
 assert(!teacherModelInputSchema.safeParse({...model.input,apiKey:'fixture-not-a-real-key'}).success);
 assert(!teacherModelInputSchema.safeParse({...model.input,model:'sk-not-a-model'}).success);
 assert(!teacherModelInputSchema.safeParse({...model.input,endpoint:'https://example.test'}).success);
});
test('agent drafts reject unbounded teacher prompts and excessive teaching demand',()=>{
 assert(!teacherAgentInputSchema.safeParse({...DEFAULT_TEACHER_AGENT,systemPrompt:'x'.repeat(8001)}).success);
 assert(!teacherAgentInputSchema.safeParse({...DEFAULT_TEACHER_AGENT,policy:{...DEFAULT_TEACHER_AGENT.policy,hintLimit:100}}).success);
 assert(!teacherAgentInputSchema.safeParse({...DEFAULT_TEACHER_AGENT,policy:{...DEFAULT_TEACHER_AGENT.policy,forceRepetition:true}}).success);
});
