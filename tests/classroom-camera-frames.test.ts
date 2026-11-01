import assert from 'node:assert/strict';
import test from 'node:test';
import {ClassroomCameraFrames,type ClassroomCameraFramesDependencies} from '../lib/classroom-camera-frames';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function harness(deferred=false){
 let timer:(()=>void)|undefined,blobCallback:BlobCallback|undefined,plays=0,pauses=0,stopped=0;
 const frames:string[]=[],errors:string[]=[],sizes:number[][]=[];
 const video={srcObject:null,muted:false,playsInline:false,videoWidth:1280,videoHeight:720,readyState:2,play:async()=>{plays++;},pause:()=>{pauses++;}};
 const canvas={width:0,height:0,getContext:()=>({drawImage:()=>sizes.push([canvas.width,canvas.height])}),toBlob:(cb:BlobCallback)=>{blobCallback=cb;if(!deferred)cb(new Blob([new Uint8Array([255,216,255,224,1,2,3])],{type:'image/jpeg'}));}};
 const stream={getVideoTracks:()=>[{readyState:'live'}],getTracks:()=>[{stop:()=>stopped++}]} as unknown as MediaStream;
 const dependencies:ClassroomCameraFramesDependencies={video:()=>video as unknown as HTMLVideoElement,canvas:()=>canvas as unknown as HTMLCanvasElement,every:(cb,ms)=>{assert.equal(ms,1000);timer=cb;return 1;},cancel:()=>{timer=undefined;}};
 const owner=new ClassroomCameraFrames(dependencies);
 return{owner,stream,frames,errors,sizes,video,canvas,fire:()=>timer?.(),resolve:(blob:Blob|null)=>blobCallback?.(blob),get plays(){return plays;},get pauses(){return pauses;},get stopped(){return stopped;}};
}
test('frames require explicit start, use unmirrored bounded JPEG and never own camera tracks',async()=>{
 const h=harness();assert.equal(h.plays,0);assert.deepEqual(h.frames,[]);
 h.owner.start(h.stream,image=>h.frames.push(image),message=>h.errors.push(message));await tick();
 assert.equal(h.plays,1);assert.equal(h.video.srcObject,h.stream);h.fire();await tick();
 assert.deepEqual(h.sizes,[[640,360]]);assert.equal(h.frames.length,1);assert.equal(h.frames[0],'/9j/4AECAw==');
 h.owner.stop();h.fire();assert.equal(h.video.srcObject,null);assert.equal(h.stopped,0);assert.equal(h.pauses,1);
});
test('pending blob never overlaps or emits after stop, including a subsequent generation',async()=>{
 const h=harness(true);h.owner.start(h.stream,image=>h.frames.push(image),message=>h.errors.push(message));await tick();h.fire();h.fire();assert.equal(h.sizes.length,1);
 h.owner.stop();h.owner.start(h.stream,image=>h.frames.push('new:'+image),message=>h.errors.push(message));await tick();
 h.resolve(new Blob([new Uint8Array([255,216,255,224])],{type:'image/jpeg'}));await tick();assert.deepEqual(h.frames,[]);h.owner.stop();
});
test('invalid JPEG and stopped camera report only safe visual errors',async()=>{
 const h=harness(true);h.owner.start(h.stream,image=>h.frames.push(image),message=>h.errors.push(message));await tick();h.fire();h.resolve(new Blob(['PRIVATE'],{type:'text/plain'}));await tick();
 assert.deepEqual(h.frames,[]);assert.equal(h.errors.length,1);assert(!h.errors[0].includes('PRIVATE'));h.owner.stop();
});
test('busy images lower JPEG quality and dimensions to stay below the independent audio-safe budget',async()=>{
 const h=harness();h.canvas.toBlob=cb=>{const bytes=new Uint8Array(h.canvas.width>320?20000:12000);bytes.set([255,216,255,224]);cb(new Blob([bytes],{type:'image/jpeg'}));};
 h.owner.start(h.stream,image=>h.frames.push(image),message=>h.errors.push(message));await tick();h.fire();await tick();await tick();
 assert.deepEqual(h.sizes,[[640,360],[640,360],[640,360],[320,180]]);assert.equal(h.frames.length,1);assert(h.frames[0].length<=24000);assert.deepEqual(h.errors,[]);h.owner.stop();
});
test('persistent oversize frames stop visual sharing rather than allocating or queueing oversized Base64',async()=>{
 const h=harness();h.canvas.toBlob=cb=>cb(new Blob([new Uint8Array(150000)],{type:'image/jpeg'}));
 h.owner.start(h.stream,image=>h.frames.push(image),message=>h.errors.push(message));await tick();h.fire();await tick();await tick();
 assert.equal(h.sizes.length,5);assert.deepEqual(h.frames,[]);assert.equal(h.errors.length,1);assert.equal(h.stopped,0);h.owner.stop();
});
test('ended camera tracks stop frame generation without taking ownership of preview tracks',async()=>{
 const h=harness();const stream={getVideoTracks:()=>[{readyState:'ended'}]} as unknown as MediaStream;
 h.owner.start(stream,image=>h.frames.push(image),message=>h.errors.push(message));await tick();h.fire();await tick();assert.equal(h.errors.length,1);assert.deepEqual(h.frames,[]);assert.equal(h.stopped,0);
});
