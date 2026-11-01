import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClassroomSnapshot } from '../lib/classroom-contract';
import { PICNIC_COURSE } from '../lib/server/course-catalog';
import { buildClassroomSummary } from '../lib/classroom-summary';

function snapshot(extra: Partial<ClassroomSnapshot> = {}): ClassroomSnapshot {
 return {id:'10000000-0000-4000-8000-000000000001',course:PICNIC_COURSE,profile:{name:'Test',ageRange:'10–11',level:'unsure'},preferences:{provider:'qwen',language:'bilingual',style:'gentle',voice:'female',soundEffects:false},status:'ended',revision:3,connectionEpoch:1,stepIndex:0,elapsedSeconds:65,remainingSeconds:835,maxSeconds:900,outcomes:[],teacherObjectIds:[],feedback:null,endReason:'manual',startedAt:'2026-11-01T00:00:00Z',endedAt:'2026-11-01T00:01:05Z',reportStatus:'unavailable',...extra};
}
test('summary names the actual activities and distinguishes independent, assisted and skipped evidence',()=>{
 const value=buildClassroomSummary(snapshot({stepIndex:3,outcomes:[{stepId:'find-apple',status:'independent'},{stepId:'say-apple',status:'assisted'},{stepId:'find-banana',status:'skipped'}]}));
 assert.equal(value.empty,false);
 assert.deepEqual(value.completed.map(item=>[item.stepId,item.status]),[['find-apple','independent'],['say-apple','assisted']]);
 assert(value.completed[0].label.includes('苹果'));
 assert(value.practice.some(item=>item.stepId==='say-apple'&&item.reason.includes('提示')));
 assert(value.practice.some(item=>item.stepId==='find-banana'&&item.reason.includes('跳过')));
 assert(!JSON.stringify(value).match(/已掌握|发音评分|注意力|不认识|不会/));
});
test('unfinished and never-assessed activity is not presented as an error or a completed expression',()=>{
 const value=buildClassroomSummary(snapshot());
 assert.equal(value.empty,true);assert.deepEqual(value.completed,[]);
 assert.equal(value.practice.length,0);assert(value.nextStep.includes('找一找苹果'));
 assert(value.description.includes('记录'));
});
test('time-limited and manual endings retain their reason and checkpoint',()=>{
 for(const endReason of ['manual','time_limit','daily_limit'] as const){
  const value=buildClassroomSummary(snapshot({endReason,stepIndex:2}));
  assert(value.description.includes(endReason==='manual'?'中途':endReason==='time_limit'?'时间':'今日'));
  assert(value.nextStep.includes('找一找香蕉'));
 }
});
test('unassessed listening, unknown and repeated step IDs cannot manufacture achievements',()=>{
 const course={...PICNIC_COURSE,steps:[...PICNIC_COURSE.steps,{id:'chat',kind:'listen' as const,pageId:'picnic-table',targetId:null,english:'Talk freely.',chinese:'自由交流',hint:'Share a thought.',expected:null}]};
 const value=buildClassroomSummary(snapshot({course,stepIndex:course.steps.length,endReason:'content_completed',outcomes:[{stepId:'find-apple',status:'independent'},{stepId:'find-apple',status:'assisted'},{stepId:'unknown',status:'independent'},{stepId:'chat',status:'unassessed'}]}));
 assert.equal(value.completed.length,1);assert.deepEqual(value.practice,[]);
 assert(value.description.includes('完成'));assert(!value.nextStep.includes('自由交流'));
});
