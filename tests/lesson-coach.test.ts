import test from 'node:test';
import assert from 'node:assert/strict';
import { LessonCoach, coachPrompt, coachControl } from '../lib/lesson-coach.ts';
import { createDemoBook } from '../lib/demo.ts';
import type { LiveContext } from '../lib/live-protocol.ts';
const book=createDemoBook();
const context:LiveContext={contextKey:'fruit:select',lessonTitle:'Fruit',age:10,step:book.lessons[0].steps[1],objects:book.pages[0].objects,selectedIds:[],answered:false};
const samples=(coach:LessonCoach,at:number)=>{coach.media('child',0,at);coach.media('teacher',0,at);};
function begin(){const c=new LessonCoach();c.reset(context,0);c.speechRequested(0);c.media('teacher',.1,1000);c.media('child',0,1000);return c;}
test('real playback followed by quiet produces exactly three graded interventions',()=>{
 const c=begin();samples(c,8999);assert.equal(c.tick(8999,false),null);samples(c,9000);assert.deepEqual(c.tick(9000,false),{type:'nudge',stage:1});
 c.speechRequested(9000);samples(c,18000);assert.equal(c.tick(18000,false),null); // Do not speak over undelivered output.
 c.media('teacher',.1,19000);samples(c,31000);assert.deepEqual(c.tick(31000,false),{type:'nudge',stage:2});
 c.speechRequested(31000);c.media('teacher',.1,32000);samples(c,48000);assert.deepEqual(c.tick(48000,false),{type:'nudge',stage:3});
 c.speechRequested(48000);c.media('teacher',.1,49000);samples(c,90000);assert.equal(c.tick(90000,false),null);
});
test('microphone speech, drawing activity and transcript fragments restart thinking time',()=>{
 const c=begin();c.media('child',.1,8500);samples(c,10000);assert.equal(c.tick(10000,false),null);
 c.activity(16000,true);samples(c,20000);assert.equal(c.tick(20000,false),null);
 c.update({...context,selectedIds:['0-banana']},21000,true);samples(c,28000);assert.equal(c.tick(28000,false),null);
});
test('stale media samples, mute/pause and pending work do not establish silence',()=>{
 const c=begin();assert.equal(c.tick(12000,false),null);samples(c,12000);assert.equal(c.tick(12000,true),null);
 c.setEnabled(false,12000);samples(c,50000);assert.equal(c.tick(50000,false),null);
});
test('silence never passes unanswered exercises; only confirmed/listen states may progress',()=>{
 const c=begin();samples(c,9000);assert.equal(c.tick(9000,false)?.type,'nudge');
 c.update({...context,answered:true},10000,true);samples(c,15999);assert.equal(c.tick(15999,false),null);samples(c,16000);assert.deepEqual(c.tick(16000,false),{type:'advance'});
 assert.equal(c.tick(17000,false),null);
});
test('missing playback is diagnosed once, never treated as a completed teaching turn',()=>{
 const c=new LessonCoach();c.reset({...context,step:book.lessons[0].steps[0]},0);samples(c,21000);assert.deepEqual(c.tick(21000,false),{type:'missing_audio'});samples(c,50000);assert.equal(c.tick(50000,false),null);
});
test('a new context preserves pending playback and requires the new prompt to be heard',()=>{
 const c=begin();c.speechRequested(3000);c.reset({...context,contextKey:'new-task'},3100);samples(c,12000);assert.equal(c.tick(12000,false),null);
 c.media('teacher',.1,15000);samples(c,23000);assert.deepEqual(c.tick(23000,false),{type:'nudge',stage:1});
});
test('wait requests hold guidance and stage three demonstrates without crediting silence',()=>{
 const c=begin();c.hold(5000);samples(c,30000);assert.equal(c.tick(30000,false),null);
 assert.match(coachPrompt(context,3),/not a correct answer/);
});

test('pause controls respect intent, without treating lesson vocabulary as a command',()=>{
 for(const text of ['stop','Please pause the lesson.','暂停一下'])assert.equal(coachControl(text),'pause');
 for(const text of ['what does stop mean?','do not stop','不要停','How do you say pause?'])assert.equal(coachControl(text),null);
 assert.equal(coachControl('let me think'),'wait');
});
