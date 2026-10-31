import React from 'react';
import test, {after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>');
for(const key of ['window','document','HTMLElement','Node','MutationObserver','navigator'])Object.defineProperty(globalThis,key,{value:(dom.window as unknown as Record<string,unknown>)[key],configurable:true});
const {render,cleanup,act}=await import('@testing-library/react');
const {TeacherAvatarMotion}=await import('../components/product/teacher-avatar-state');
const {TeacherAvatar}=await import('../components/product/teacher-avatar');
afterEach(cleanup);after(()=>dom.window.close());
const input={level:0,connected:true,childSpeaking:false,celebrating:false,allowHandoff:true};

test('silence before any teacher audio never initiates a handoff',()=>{
 const motion=new TeacherAvatarMotion();assert.deepEqual(motion.sample(input,0),{mouth:'closed',handingOff:false});assert.deepEqual(motion.sample(input,5000),{mouth:'closed',handingOff:false});
});
test('actual energy selects four rig mouth groups, holds changes 80ms and closes within 120ms',()=>{
 const motion=new TeacherAvatarMotion();assert.equal(motion.sample({...input,level:.012},0).mouth,'small');assert.equal(motion.sample({...input,level:.08},40).mouth,'small');assert.equal(motion.sample({...input,level:.08},80).mouth,'wide');assert.equal(motion.sample({...input,level:.026},120).mouth,'wide');assert.equal(motion.sample({...input,level:.026},160).mouth,'oo');assert.equal(motion.sample(input,259).mouth,'oo');assert.equal(motion.sample(input,260).mouth,'closed');
});
test('short gaps close the beak without handing off; sustained played silence hands off once',()=>{
 const motion=new TeacherAvatarMotion();motion.sample({...input,level:.08},0);assert.equal(motion.sample(input,120).mouth,'closed');assert.equal(motion.sample(input,650).handingOff,false);assert.equal(motion.sample(input,1199).handingOff,false);assert.equal(motion.sample(input,1200).handingOff,true);assert.equal(motion.sample(input,1600).handingOff,true);assert.equal(motion.sample({...input,level:.08},1700).handingOff,false);
});
test('child speech cancels a handoff and silence cannot replay that old handoff',()=>{
 const motion=new TeacherAvatarMotion();motion.sample({...input,level:.08},0);assert.equal(motion.sample(input,1200).handingOff,true);assert.equal(motion.sample({...input,childSpeaking:true},1300).handingOff,false);assert.equal(motion.sample(input,6000).handingOff,false);
});
test('paused, disconnected and ended-equivalent inputs discard mouth and handoff history',()=>{
 for(const inactive of [{connected:false},{paused:true}]){const motion=new TeacherAvatarMotion();motion.sample({...input,level:.08},0);motion.sample(input,1200);assert.deepEqual(motion.sample({...input,...inactive,level:.8},1250),{mouth:'closed',handingOff:false});assert.deepEqual(motion.sample(input,6000),{mouth:'closed',handingOff:false});}
});
test('pending playback or celebration prevents handoff without faking teacher audio',()=>{
 const motion=new TeacherAvatarMotion();motion.sample({...input,level:.08},0);assert.equal(motion.sample({...input,allowHandoff:false},1800).handingOff,false);assert.equal(motion.sample({...input,celebrating:true},2000).handingOff,false);assert.equal(motion.sample(input,2200).handingOff,true);
});
test('invalid levels are silent and never arm a handoff',()=>{
 const motion=new TeacherAvatarMotion();for(const [i,level]of[NaN,Infinity,-1].entries())assert.deepEqual(motion.sample({...input,level},i*2000),{mouth:'closed',handingOff:false});
});
test('the rendered avatar swaps only original mouth groups, keeps one fixed rig, and cleans its frame loop',()=>{
 const originalRAF=globalThis.requestAnimationFrame,originalCancel=globalThis.cancelAnimationFrame;let frame:FrameRequestCallback|undefined,cancelled=0;
 globalThis.requestAnimationFrame=callback=>{frame=callback;return 1;};globalThis.cancelAnimationFrame=()=>{cancelled++;};
 try{
  const view=render(<TeacherAvatar {...input} level={.08}/>),head=view.container.querySelector('.tk-teeko-head');act(()=>frame!(0));assert.equal(view.container.querySelector('[data-mouth]')?.getAttribute('data-mouth'),'wide');assert.equal(view.container.querySelectorAll('[data-viseme]').length,4);assert.equal(view.container.querySelector('[data-viseme="wide"]')?.getAttribute('style'),'display: inline;');
  view.rerender(<TeacherAvatar {...input}/>);act(()=>frame!(120));assert.equal(view.container.querySelector('[data-mouth]')?.getAttribute('data-mouth'),'closed');act(()=>frame!(1200));assert.equal(view.container.querySelector('[data-handoff]')?.getAttribute('data-handoff'),'true');assert.equal(view.container.querySelector('.tk-teeko-head'),head);assert.equal(head?.getAttribute('transform'),null);
  view.rerender(<TeacherAvatar {...input} connected={false}/>);assert.equal(view.container.querySelector('[data-handoff]')?.getAttribute('data-handoff'),'false');assert.equal(view.container.querySelector('[data-mouth]')?.getAttribute('data-mouth'),'closed');view.unmount();assert.equal(cancelled,1);
 }finally{globalThis.requestAnimationFrame=originalRAF;globalThis.cancelAnimationFrame=originalCancel;}
});
