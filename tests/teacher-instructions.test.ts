import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTeacherInstructions,readTeachingState,recordTeachingEvidence} from '../lib/teacher-instructions';
import {teacherConfig,teacherSnapshot} from './teacher-runtime-fixture';

test('teacher instructions combine fixed rules, actual level policy, user preference and untrusted task data',()=>{
 const initial=teacherSnapshot();
 const starter=buildTeacherInstructions(initial,teacherConfig);
 assert(starter.indexOf('NON-OVERRIDABLE')<starter.indexOf('AGENT MAIN PROMPT'));
 assert(starter.includes('maxWordsPerSentence=8'));assert(starter.includes('English level: starter'));
 assert(starter.includes('brief Chinese'));assert(starter.includes('REFERENCE DATA'));
 const advanced=buildTeacherInstructions({...initial,profile:{...initial.profile,level:'conversation'},preferences:{...initial.preferences,language:'english',style:'strict'}},teacherConfig);
 assert(advanced.includes('maxWordsPerSentence=18'));assert(advanced.includes('English only'));
 assert(advanced.includes('strict'));assert(advanced.includes('never force repetition'));
});
test('uncertain level starts with low-barrier observation rather than treating age as ability',()=>{
 const state=teacherSnapshot();const prompt=buildTeacherInstructions({...state,profile:{...state.profile,level:'unsure',ageRange:'12–13'}},teacherConfig);
 assert(prompt.includes('provisional'));assert(prompt.includes('not a placement test'));assert(prompt.includes('maxWordsPerSentence=8'));
});
test('only several valid independent or supported attempts adapt activity level, not one unclear answer',()=>{
 const initial=readTeachingState({},'starter');
 const clearer=recordTeachingEvidence(initial,'clarify',false,teacherConfig.policy);
 assert.deepEqual(clearer.evidence,[]);assert.equal(clearer.level,'starter');
 let state=initial;
 for(let i=0;i<teacherConfig.policy.adaptationEvidence;i++)state=recordTeachingEvidence(state,'correct',false,teacherConfig.policy);
 assert.equal(state.level,'sentences');
 const conversation=recordTeachingEvidence(state,'conversation',false,teacherConfig.policy);assert.equal(conversation.level,'sentences');
 for(let i=0;i<teacherConfig.policy.adaptationEvidence;i++)state=recordTeachingEvidence(state,'retry',false,teacherConfig.policy);
 assert.equal(state.level,'starter');
});
test('prompt exposes bounded hint ladder and conversational tangent policy without manufacturing progress',()=>{
 const state=readTeachingState({hints:{'say-apple':2},digressionTurns:3},'starter');
 const prompt=buildTeacherInstructions(teacherSnapshot(),teacherConfig,state);
 assert(prompt.includes('Hint limit reached'));assert(prompt.includes('natural pause'));assert(prompt.includes('not pronunciation mastery'));
 assert(!prompt.includes('first impose another repetition'));
});
