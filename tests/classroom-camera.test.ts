import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassroomCamera } from '../lib/classroom-camera.ts';
function media(){let stopped=0;const track=new EventTarget() as EventTarget & {stop():void};track.stop=()=>{stopped++;};return{stream:{getTracks:()=>[track],getVideoTracks:()=>[track]} as unknown as MediaStream,track,get stopped(){return stopped;}};}
test('camera only requests video after explicit start, and stop releases its own tracks',async()=>{
 const f=media();let calls=0;const owner=new ClassroomCamera(()=>{},async constraints=>{calls++;assert.deepEqual(constraints,{audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480}}});return f.stream;});
 assert.equal(calls,0);await owner.start();assert.equal(calls,1);assert.equal(owner.state.status,'on');owner.stop();assert.equal(f.stopped,1);assert.equal(owner.state.stream,null);owner.dispose();
});
test('denied permission leaves the lesson usable and a later explicit click can retry',async()=>{
 const f=media();let calls=0;const owner=new ClassroomCamera(()=>{},async()=>{if(++calls===1)throw new DOMException('private browser detail','NotAllowedError');return f.stream;});
 await owner.start();assert.equal(owner.state.status,'denied');assert.equal(owner.state.stream,null);assert.ok(!owner.state.message.includes('private'));await owner.start();assert.equal(owner.state.status,'on');owner.dispose();assert.equal(f.stopped,1);
});
test('cancelled or unmounted camera requests stop late permission streams without reopening',async()=>{
 const f=media();let resolve!:(stream:MediaStream)=>void;const owner=new ClassroomCamera(()=>{},()=>new Promise(r=>{resolve=r;}));const opening=owner.start();owner.stop();resolve(f.stream);await opening;assert.equal(f.stopped,1);assert.equal(owner.state.status,'off');owner.dispose();
});
test('a second click does not create a second pending camera request',async()=>{
 const f=media();let resolve!:(stream:MediaStream)=>void,calls=0;const owner=new ClassroomCamera(()=>{},()=>{calls++;return new Promise(r=>{resolve=r;});});const first=owner.start();await owner.start();assert.equal(calls,1);resolve(f.stream);await first;f.track.dispatchEvent(new Event('ended'));assert.equal(owner.state.status,'off');assert.equal(f.stopped,1);owner.dispose();
});
for(const kind of ['stop','dispose'] as const)test(`camera grant racing with ${kind} still stops every returned track`,async()=>{
 const f=media();let resolve!:(stream:MediaStream)=>void;
 const owner=new ClassroomCamera(()=>{},()=>new Promise(r=>{resolve=r;}));const opening=owner.start();
 resolve(f.stream);queueMicrotask(()=>owner[kind]());await opening;
 assert.equal(owner.state.status,'off');assert.equal(f.stopped,1);
});
