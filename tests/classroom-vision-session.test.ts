import test from 'node:test';
import assert from 'node:assert/strict';
import {ClassroomVisionSession,decodeClassroomVisionJpeg} from '../lib/server/classroom-vision-session.ts';
const image=Buffer.from([255,216,255,192,0,11,8,0,240,1,64,1,1,17,0,255,217]).toString('base64');
const frame=(generation=1,sequence=1)=>({type:'vision.frame',generation,sequence,image});
function fixture(provider:'qwen'|'openai'='qwen'){
 let now=10000,key='class:1:0',audio=true,observations=0,resolve!:(value:{visible:boolean;description:string})=>void;
 const statuses:unknown[]=[],images:string[]=[],notes:string[]=[];
 const session=new ClassroomVisionSession({provider,now:()=>now,context:()=>({key,objective:'Find the apple.'}),authorize:async()=>true,canSendQwen:()=>audio,sendQwen:image=>{images.push(image);return true;},status:state=>statuses.push(state),sharingChanged:()=>{},observed:value=>notes.push(value.description),observe:async(_input,signal)=>{observations++;return new Promise((r,j)=>{resolve=r;signal.addEventListener('abort',()=>j(new Error('cancelled')),{once:true});});}});
 return{session,statuses,images,notes,get observations(){return observations;},resolve:(description='A person is holding a banana.')=>resolve({visible:true,description}),advance:(ms:number)=>{now+=ms;},task:()=>{key='class:1:1';session.contextChanged();},audio:(value:boolean)=>{audio=value;}};
}
test('JPEG validation bounds bytes, encoding and actual SOF dimensions',()=>{
 assert.deepEqual(decodeClassroomVisionJpeg(image),{width:320,height:240});
 for(const invalid of ['https://example.com/a.jpg',image+'A','YWJj',Buffer.from([255,216,255,192,0,11,8,4,0,4,0,1,1,17,0,255,217]).toString('base64')])assert.equal(decodeClassroomVisionJpeg(invalid),null);
});
test('Qwen receives only explicitly shared, current, paced JPEG frames after audio and never calls OpenAI',async()=>{
 const f=fixture();await f.session.handle(frame());assert.equal(f.images.length,0);
 await f.session.handle({type:'vision.start',generation:1});f.audio(false);await f.session.handle(frame());assert.equal(f.images.length,0);
 f.audio(true);f.advance(1000);await f.session.handle(frame(1,2));assert.equal(f.images.length,1);assert.equal(f.observations,0);
 await f.session.handle(frame(1,3));assert.equal(f.images.length,1);f.advance(1000);await f.session.handle(frame(1,2));assert.equal(f.images.length,1);
 await f.session.handle({type:'vision.stop',generation:1});f.advance(1000);await f.session.handle(frame(1,4));assert.equal(f.images.length,1);f.session.close();
});
test('GPT uses its observer, keeps at most one request and injects only a current observation',async()=>{
 const f=fixture('openai');await f.session.handle({type:'vision.start',generation:1});await f.session.handle(frame());assert.equal(f.observations,1);assert.equal(f.images.length,0);
 f.advance(3000);await f.session.handle(frame(1,2));assert.equal(f.observations,1);f.resolve();await new Promise(r=>setImmediate(r));assert.deepEqual(f.notes,['A person is holding a banana.']);f.session.close();
});
for(const change of ['stop','task','close'] as const)test(`late GPT image results are discarded after ${change}`,async()=>{
 const f=fixture('openai');await f.session.handle({type:'vision.start',generation:1});await f.session.handle(frame());
 if(change==='stop')await f.session.handle({type:'vision.stop',generation:1});else if(change==='task')f.task();else f.session.close();
 f.resolve();await new Promise(r=>setImmediate(r));assert.equal(f.notes.length,0);f.session.close();
});
test('vision errors and bad frames do not throw a media failure or accept client supplied provider choices',async()=>{
 const f=fixture();await f.session.handle({type:'vision.start',generation:1,provider:'openai'});await f.session.handle(frame());assert.equal(f.images.length,0);
 await f.session.handle({type:'vision.start',generation:2});await f.session.handle({...frame(2),image:'not-an-image'});assert.equal(f.images.length,0);f.session.close();
});

test('authorization delays cannot reorder frames or burst old images into a later media window',async()=>{
 let now=10000;const pending:((allowed:boolean)=>void)[]=[],sent:{at:number;image:string}[]=[];
 const session=new ClassroomVisionSession({provider:'qwen',now:()=>now,context:()=>({key:'c:1:0',objective:'Look.'}),authorize:()=>new Promise(r=>pending.push(r)),canSendQwen:()=>true,sendQwen:image=>{sent.push({at:now,image});return true;},status:()=>{},sharingChanged:()=>{},observed:()=>{}});
 await session.handle({type:'vision.start',generation:1});const first=session.handle(frame(1,1));now+=1000;const second=session.handle(frame(1,2));pending[1](true);await second;pending[0](true);await first;
 assert.equal(sent.length,1);session.close();
});
test('revocation during GPT observation prevents injecting its result',async()=>{
 let allowed=true,calls=0,injected=0,resolve!:(value:{visible:boolean;description:string})=>void;
 const session=new ClassroomVisionSession({provider:'openai',context:()=>({key:'c:1:0',objective:'Look.'}),authorize:async()=>{calls++;return allowed;},canSendQwen:()=>false,sendQwen:()=>false,status:()=>{},sharingChanged:()=>{},observed:()=>{injected++;},observe:()=>new Promise(r=>{resolve=r;})});
 await session.handle({type:'vision.start',generation:1});await session.handle(frame());allowed=false;resolve({visible:true,description:'A blue toy car.'});await new Promise(r=>setImmediate(r));assert.equal(injected,0);assert.equal(calls,2);session.close();
});
test('an old pending authorization cannot stop a newer sharing generation',async()=>{
 let resolve!:(value:boolean)=>void;const session=new ClassroomVisionSession({provider:'qwen',context:()=>({key:'c:1:0',objective:'Look.'}),authorize:()=>new Promise(r=>{resolve=r;}),canSendQwen:()=>true,sendQwen:()=>true,status:()=>{},sharingChanged:()=>{},observed:()=>{}});
 await session.handle({type:'vision.start',generation:1});const waiting=session.handle(frame());await session.handle({type:'vision.stop',generation:1});await session.handle({type:'vision.start',generation:2});resolve(false);await waiting;assert.equal(session.sharing,true);session.close();
});

test('starting a replacement sharing generation invalidates the prior visual reference',async()=>{
 let invalidations=0;const session=new ClassroomVisionSession({provider:'qwen',context:()=>({key:'c:1:0',objective:'Look.'}),authorize:async()=>true,canSendQwen:()=>true,sendQwen:()=>true,status:()=>{},sharingChanged:()=>{},observed:()=>{},invalidated:()=>{invalidations++;}});
 await session.handle({type:'vision.start',generation:1});const first=invalidations;await session.handle({type:'vision.start',generation:2});assert.equal(invalidations,first+1);session.close();
});
