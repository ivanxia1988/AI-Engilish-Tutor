import test from 'node:test';
import assert from 'node:assert/strict';
import { classroomControl, spokenTaskAttempt } from '../lib/server/classroom-teaching.ts';
import { PICNIC_COURSE, PICNIC_COURSE_V1 } from '../lib/server/course-catalog.ts';
import { classroomInstructions } from '../lib/server/classroom-runtime.ts';
import type { ClassroomSnapshot } from '../lib/classroom-contract.ts';

const words=['apple','banana','strawberry'];
const naming=PICNIC_COURSE_V1.steps[1];
test('only a complete explicit current-activity request skips or pauses',()=>{
 for(const text of ['skip','Please skip this.','Can we skip this?','换一题','不想重复了'])assert.equal(classroomControl(text),'skip',text);
 for(const text of ['Please stop.','pause','暂停'])assert.equal(classroomControl(text),'pause',text);
 for(const text of ['Next weekend I will visit my grandma.','Tell me another story.','I skipped breakfast.','Can you explain the next word?','I do not want to skip this.'])assert.equal(classroomControl(text),null,text);
});
test('naming accepts concise answers but a fruit mentioned in a story is conversation',()=>{
 for(const text of ['apple','An apple.','It is an apple.','I found an apple.','This is a red apple.'])assert.equal(spokenTaskAttempt(naming,text,words),'correct',text);
 for(const text of ['My dog stole an apple yesterday.','Do you like apples?','Can you see an apple in my camera?','Yesterday we saw an apple tree.','I want to tell you about my dog.','Tell me another story.','My dog eats apples.'])assert.equal(spokenTaskAttempt(naming,text,words),'conversation',text);
 assert.equal(spokenTaskAttempt(naming,'It is a banana.',words),'retry');
 assert.equal(spokenTaskAttempt(naming,'It is not an apple.',words),'retry');
 assert.equal(spokenTaskAttempt(naming,'apple or banana',words),'retry');
 assert.equal(spokenTaskAttempt(naming,'Not an apple. It is a banana.',words),'retry');
});
test('unrelated statements and greetings stay conversation in every speaking activity',()=>{
 for(const step of PICNIC_COURSE.steps.filter(step=>step.kind==='speak')){
  for(const text of ['I like dinosaurs.','I love football.','It is raining today.','I will bring my dog.','Hello!','Thanks.','Good morning.'])assert.equal(spokenTaskAttempt(step,text,words),'conversation',`${step.id}: ${text}`);
 }
});
test('invitations accept common equivalent phrases without crediting stories or unrelated questions',()=>{
 const invite=PICNIC_COURSE.steps.find(step=>step.id==='invite-friend')!;
 for(const text of ["Let’s go on a picnic!",'Would you like to join our picnic?','Do you want to go on a picnic?','Shall we have a picnic?',"Let's have a picnic in the park!",'Would you like to join us for a picnic, please?'])assert.equal(spokenTaskAttempt(invite,text,words),'correct',text);
 for(const text of ['Yesterday we had a picnic.','Do you like picnics?','I watched a movie about a picnic.'])assert.equal(spokenTaskAttempt(invite,text,words),'conversation',text);
 assert.equal(spokenTaskAttempt(invite,"Let’s not have a picnic.",words),'retry');
});
test('new picnic course retains v1 and gives choices and applied expressions before open conversation',()=>{
 assert.equal(PICNIC_COURSE_V1.version,'1');assert.equal(PICNIC_COURSE_V1.steps.length,7);
 assert.equal(PICNIC_COURSE.version,'2');assert(PICNIC_COURSE.steps.length>7);
 const choice=PICNIC_COURSE.steps.find(step=>step.id==='my-choice')!;
 assert.equal(spokenTaskAttempt(choice,'apple',words),'retry');
 for(const text of ['I like apples.','I would take a banana.','My favorite fruit is strawberries.'])assert.equal(spokenTaskAttempt(choice,text,words),'correct',text);
 const invite=PICNIC_COURSE.steps.find(step=>step.id==='invite-friend')!;
 assert.equal(spokenTaskAttempt(invite,"Let's have a picnic!",words),'correct');
 assert.equal(spokenTaskAttempt(invite,'picnic',words),'retry');
 const pack=PICNIC_COURSE.steps.find(step=>step.id==='pack-picnic')!;
 assert.equal(spokenTaskAttempt(pack,'I will bring apples.',words),'correct');
 assert.equal(spokenTaskAttempt(pack,'I like apples.',words),'retry');
 const chat=PICNIC_COURSE.steps.at(-1)!;assert.equal(chat.id,'picnic-chat');assert.equal(chat.kind,'listen');assert.equal(chat.expected,null);
 assert.equal(spokenTaskAttempt(chat,'I like apples.',words),'conversation');
});
test('tutor instruction permits a child-led tangent and does not treat a finished checklist as a hang-up',()=>{
 const snapshot={id:'test',connectionEpoch:1,stepIndex:0,profile:{name:'Child',ageRange:'10–11'},preferences:{language:'bilingual',style:'gentle'},course:PICNIC_COURSE,teacherObjectIds:[],feedback:null,outcomes:[]} as unknown as ClassroomSnapshot;
 const instructions=classroomInstructions(snapshot);
 assert.match(instructions,/follow-up/i);assert.match(instructions,/not.*immediately.*back/i);assert.match(instructions,/do not announce.*ended/i);
 assert(!instructions.includes('move naturally to the new question'));
});
