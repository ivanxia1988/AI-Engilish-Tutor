import React from 'react';
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { ClassroomSnapshot } from '../lib/classroom-contract';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/courses' });
for (const key of ['window', 'self', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'navigator']) Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true });
function check(value:unknown):asserts value { assert.equal(Boolean(value),true); }
const { render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const { Courses } = await import('../components/product/courses.tsx');
const { Classroom } = await import('../components/product/classroom.tsx');
afterEach(cleanup); after(() => dom.window.close());
export const snapshot: ClassroomSnapshot = {
 id:'10000000-0000-4000-8000-000000000001', course:{id:'picnic',version:'1',title:'一起去野餐',subtitle:"Let's have a picnic!",description:'聊聊喜欢的水果。',words:['apple','banana'],objectives:['认识水果','说说喜欢什么'],durationMinutes:8,pages:[{id:'p1',image:'/course-assets/picnic-v1.svg',width:900,height:720,objects:[{id:'apple',label:'apple',chinese:'苹果',box:{x:.15,y:.3,w:.25,h:.35}}]}],steps:[{id:'find-apple',kind:'select',pageId:'p1',targetId:'apple',english:'Can you find the apple?',chinese:'找出苹果',hint:'Look for the red fruit.',expected:'apple'}]},
 profile:{name:'Mia',ageRange:'8–9',level:'starter'},preferences:{provider:'qwen',language:'bilingual',style:'gentle',voice:'female',soundEffects:false},status:'preflight',revision:0,connectionEpoch:0,stepIndex:0,elapsedSeconds:0,remainingSeconds:600,maxSeconds:600,outcomes:[],teacherObjectIds:[],feedback:null,endReason:null,startedAt:'2026-11-01T00:00:00Z',endedAt:null,reportStatus:'unavailable'
};
const options={ok:true,providers:[{id:'qwen',name:'通义',configured:true},{id:'openai',name:'GPT Live',configured:true}],preferences:snapshot.preferences};

test('published courses offer one real start action and never request microphone on arrival', async()=>{
 let mediaCalls=0; Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{mediaCalls++;throw new Error('must not run');}}});
 const calls:{path:string,body?:unknown}[]=[],destinations:string[]=[];
 globalThis.fetch=async(input,init)=>{
  calls.push({path:String(input),body:typeof init?.body==='string'?JSON.parse(init.body):undefined});
  if(String(input).endsWith('/classroom-options'))return Response.json(options);
  if(String(input).endsWith('/classrooms'))return Response.json({ok:true,classroom:snapshot});
  return Response.json({ok:true,courses:[{...snapshot.course,progress:{stepIndex:0,completed:false}}],activeClassroom:null});
 };
 render(<Courses navigate={path=>destinations.push(path)} />);
 await waitFor(()=>check(screen.getByRole('button',{name:'跟 Teeko 老师一起学'})));
 assert.equal(mediaCalls,0);
 fireEvent.click(screen.getByRole('button',{name:'跟 Teeko 老师一起学'}));
 await waitFor(()=>assert.deepEqual(destinations,[`/classroom/${snapshot.id}`]));
 const start=calls.find(c=>c.path==='/api/v1/classrooms');
 assert.deepEqual(start?.body,{courseId:'picnic',preferences:snapshot.preferences});
 assert.equal(mediaCalls,0);
});

function fixture(initial:ClassroomSnapshot=snapshot,behavior:{pauseOnStop?:boolean}={}){
 const calls:{path:string,body?:{type?:string;expectedRevision?:number}}[]=[];
 let current=initial, stops=0,starts=0,disposes=0;
 let callbacks:Parameters<import('../components/product/classroom.tsx').VoiceFactory>[0]|null=null;
 globalThis.fetch=async(input,init)=>{
  const body=typeof init?.body==='string'?JSON.parse(init.body):undefined;calls.push({path:String(input),body});
  if(body?.expectedRevision!==undefined&&body.expectedRevision!==current.revision)return Response.json({ok:false,error:{code:'STALE_REVISION',message:'课堂已经更新，请重新试一次。'}},{status:409});
  if(body?.type==='pause')current={...current,status:'paused',revision:current.revision+1};
  if(body?.type==='resume')current={...current,status:'preflight',revision:current.revision+1};
  if(body?.type==='end')current={...current,status:'ended',revision:current.revision+1,endReason:'manual',endedAt:'2026-11-01T00:01:00Z',elapsedSeconds:60};
  return Response.json({ok:true,classroom:current});
 };
 const voiceFactory:import('../components/product/classroom.tsx').VoiceFactory=options=>{callbacks=options;return{async start(){starts++;current={...current,status:'active',revision:current.revision+1};options.onSnapshot(current);options.onState('connected');},async stop(){stops++;if(behavior.pauseOnStop)current={...current,status:'paused',revision:current.revision+1};options.onState('closed');},dispose(){disposes++;},setMuted(){},sendText(){}};};
 return{calls,voiceFactory,checkMicrophone:async()=>true,get starts(){return starts;},get stops(){return stops;},get disposes(){return disposes;},disconnect(next:ClassroomSnapshot,state:'closed'|'error'='closed'){current=next;callbacks?.onState(state);},emit(next:ClassroomSnapshot){current=next;callbacks?.onSnapshot(next);}};
}

test('classroom asks for microphone only after the check click and connects on a separate start gesture',async()=>{
 const f=fixture();let checked=0;
 render(<Classroom classroomId={snapshot.id} voiceFactory={f.voiceFactory} checkMicrophone={async()=>{checked++;return true;}}/>);
 await waitFor(()=>check(screen.getByRole('button',{name:'检查麦克风'})));
 assert.equal(checked,0);assert.equal(f.starts,0);
 fireEvent.click(screen.getByRole('button',{name:'检查麦克风'}));
 await waitFor(()=>check(!(screen.getByRole('button',{name:'开始上课'}) as HTMLButtonElement).disabled));
 assert.equal(checked,1);assert.equal(f.starts,0);
 fireEvent.click(screen.getByRole('button',{name:'开始上课'}));
 await waitFor(()=>assert.equal(f.starts,1));
 assert.equal(screen.queryByText('字幕'),null);
});

test('pause stops media and end requires confirmation, then late snapshots cannot revive it',async()=>{
 const f=fixture();render(<Classroom classroomId={snapshot.id} voiceFactory={f.voiceFactory} checkMicrophone={f.checkMicrophone}/>);
 await waitFor(()=>check(screen.getByRole('button',{name:'检查麦克风'})));
 fireEvent.click(screen.getByRole('button',{name:'检查麦克风'}));await waitFor(()=>check(!(screen.getByRole('button',{name:'开始上课'}) as HTMLButtonElement).disabled));fireEvent.click(screen.getByRole('button',{name:'开始上课'}));
 await waitFor(()=>check(screen.getByRole('button',{name:'暂停课堂'})));
 fireEvent.click(screen.getByRole('button',{name:'暂停课堂'}));
 await waitFor(()=>check(screen.getByRole('heading',{name:'已暂停'})));assert.equal(f.stops,1);
 fireEvent.click(screen.getByRole('button',{name:'结束课堂'}));
 check(screen.getByRole('dialog',{name:'结束确认'}));assert.equal(f.calls.filter(c=>c.body?.type==='end').length,0);
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});check(!screen.queryByRole('dialog',{name:'结束确认'}));check(screen.getByRole('dialog',{name:'课堂已暂停'}));
 fireEvent.click(screen.getByRole('button',{name:'结束课堂'}));fireEvent.click(screen.getByRole('button',{name:'结束并保存'}));
 await waitFor(()=>check(screen.getByRole('heading',{name:'这节课已保存'})));
 f.emit({...snapshot,status:'active',revision:99});
 await waitFor(()=>check(screen.getByRole('heading',{name:'这节课已保存'})));
 assert.equal(f.calls.filter(c=>c.body?.type==='end').length,1);
 assert.equal(f.starts,1);
});

test('an already ended lesson opens its factual summary without starting microphone or voice',async()=>{
 const f=fixture({...snapshot,status:'ended',endReason:'content_completed',endedAt:'2026-11-01T00:03:00Z',elapsedSeconds:180,outcomes:[{stepId:'find-apple',status:'assisted'}]});let checked=0;
 render(<Classroom classroomId={snapshot.id} voiceFactory={f.voiceFactory} checkMicrophone={async()=>{checked++;return true;}}/>);
 await waitFor(()=>check(screen.getByRole('heading',{name:'这节课已保存'})));
 assert.equal(checked,0);assert.equal(f.starts,0);check(screen.getByText('详细报告暂未开放。'));
 check(!screen.queryByText(/已掌握|发音分数|整理中/));
});

test('repeated selection while a server action is pending sends only one versioned action',async()=>{
 const f=fixture();const baseFetch=globalThis.fetch;let finish:((response:Response)=>void)|undefined;
 globalThis.fetch=async(input,init)=>{
  if(String(input).endsWith('/actions')&&typeof init?.body==='string'&&JSON.parse(init.body).type==='select'){
   f.calls.push({path:String(input),body:JSON.parse(init.body)});return new Promise<Response>(resolve=>{finish=resolve;});
  }
  return baseFetch(input,init);
 };
 render(<Classroom classroomId={snapshot.id} voiceFactory={f.voiceFactory} checkMicrophone={f.checkMicrophone}/>);
 await waitFor(()=>check(screen.getByRole('button',{name:'检查麦克风'})));fireEvent.click(screen.getByRole('button',{name:'检查麦克风'}));await waitFor(()=>check(!(screen.getByRole('button',{name:'开始上课'}) as HTMLButtonElement).disabled));fireEvent.click(screen.getByRole('button',{name:'开始上课'}));
 await waitFor(()=>check(!(screen.getByRole('button',{name:'选择 apple'}) as HTMLButtonElement).disabled));
 const target=screen.getByRole('button',{name:'选择 apple'});fireEvent.click(target);fireEvent.click(target);
 assert.equal(f.calls.filter(call=>call.body?.type==='select').length,1);
 finish?.(Response.json({ok:true,classroom:{...snapshot,status:'active',revision:2,feedback:{id:'answer-1',kind:'correct',message:'You found the apple!'}}}));
 await waitFor(()=>check(screen.getByText('You found the apple!')));
});

test('an action conflict rereads the authoritative classroom and does not report success',async()=>{
 const f=fixture();const baseFetch=globalThis.fetch;
 globalThis.fetch=async(input,init)=>String(input).endsWith('/actions')?Response.json({ok:false,error:{code:'STALE_REVISION',message:'课堂已经更新，请重新试一次。'}},{status:409}):baseFetch(input,init);
 render(<Classroom classroomId={snapshot.id} voiceFactory={f.voiceFactory} checkMicrophone={f.checkMicrophone}/>);
 await waitFor(()=>check(screen.getByRole('button',{name:'检查麦克风'})));fireEvent.click(screen.getByRole('button',{name:'检查麦克风'}));await waitFor(()=>check(!(screen.getByRole('button',{name:'开始上课'}) as HTMLButtonElement).disabled));fireEvent.click(screen.getByRole('button',{name:'开始上课'}));
 await waitFor(()=>check(!(screen.getByRole('button',{name:'选择 apple'}) as HTMLButtonElement).disabled));fireEvent.click(screen.getByRole('button',{name:'选择 apple'}));
 await waitFor(()=>check(screen.getByRole('alert').textContent?.includes('课堂已经更新')));
 check(f.calls.filter(call=>call.path===`/api/v1/classrooms/${snapshot.id}`).length>=2);
 check(!document.querySelector('.tk-real-fireworks'));
});

test('a pending connection replaces preflight with an accessible cancel action',async()=>{
 const f=fixture();let stopped=0;
 const waitingVoice:import('../components/product/classroom.tsx').VoiceFactory=options=>({start:async()=>{options.onState('connecting');},stop:async()=>{stopped++;options.onState('closed');},dispose(){},setMuted(){},sendText(){}});
 render(<Classroom classroomId={snapshot.id} voiceFactory={waitingVoice} checkMicrophone={f.checkMicrophone}/>);
 await waitFor(()=>check(screen.getByRole('button',{name:'检查麦克风'})));fireEvent.click(screen.getByRole('button',{name:'检查麦克风'}));await waitFor(()=>check(!(screen.getByRole('button',{name:'开始上课'}) as HTMLButtonElement).disabled));fireEvent.click(screen.getByRole('button',{name:'开始上课'}));
 check(screen.getByRole('button',{name:'取消连接'}));check(!screen.queryByRole('region',{name:'准备上课'}));
 fireEvent.click(screen.getByRole('button',{name:'取消连接'}));await waitFor(()=>assert.equal(stopped,1));
});


test('ending uses the revision after media close and succeeds with one confirmation',async()=>{
 const f=fixture(snapshot,{pauseOnStop:true});render(<Classroom classroomId={snapshot.id} voiceFactory={f.voiceFactory} checkMicrophone={f.checkMicrophone}/>);
 await waitFor(()=>check(screen.getByRole('button',{name:'检查麦克风'})));fireEvent.click(screen.getByRole('button',{name:'检查麦克风'}));await waitFor(()=>check(!(screen.getByRole('button',{name:'开始上课'}) as HTMLButtonElement).disabled));fireEvent.click(screen.getByRole('button',{name:'开始上课'}));
 await waitFor(()=>check(screen.getByRole('button',{name:'结束课堂'})));fireEvent.click(screen.getByRole('button',{name:'结束课堂'}));fireEvent.click(screen.getByRole('button',{name:'结束并保存'}));
 await waitFor(()=>check(screen.getByRole('heading',{name:'这节课已保存'})));
 const endings=f.calls.filter(call=>call.body?.type==='end');assert.equal(endings.length,1);assert.equal(endings[0].body?.expectedRevision,2);
});

test('pause accepts a server-confirmed close transition without posting a stale pause action',async()=>{
 const f=fixture(snapshot,{pauseOnStop:true});render(<Classroom classroomId={snapshot.id} voiceFactory={f.voiceFactory} checkMicrophone={f.checkMicrophone}/>);
 await waitFor(()=>check(screen.getByRole('button',{name:'检查麦克风'})));fireEvent.click(screen.getByRole('button',{name:'检查麦克风'}));await waitFor(()=>check(!(screen.getByRole('button',{name:'开始上课'}) as HTMLButtonElement).disabled));fireEvent.click(screen.getByRole('button',{name:'开始上课'}));
 await waitFor(()=>check(screen.getByRole('button',{name:'暂停课堂'})));fireEvent.click(screen.getByRole('button',{name:'暂停课堂'}));
 await waitFor(()=>check(screen.getByRole('heading',{name:'已暂停'})));assert.equal(f.calls.filter(call=>call.body?.type==='pause').length,0);check(!screen.queryByRole('alert'));
});

test('server end observed only after socket closure is reread into the terminal summary',async()=>{
 const f=fixture();render(<Classroom classroomId={snapshot.id} voiceFactory={f.voiceFactory} checkMicrophone={f.checkMicrophone}/>);
 await waitFor(()=>check(screen.getByRole('button',{name:'检查麦克风'})));fireEvent.click(screen.getByRole('button',{name:'检查麦克风'}));await waitFor(()=>check(!(screen.getByRole('button',{name:'开始上课'}) as HTMLButtonElement).disabled));fireEvent.click(screen.getByRole('button',{name:'开始上课'}));
 await waitFor(()=>assert.equal(f.starts,1));f.disconnect({...snapshot,status:'ended',revision:3,endReason:'time_limit',endedAt:'2026-11-01T00:10:00Z',elapsedSeconds:600});
 await waitFor(()=>check(screen.getByRole('heading',{name:'这节课已保存'})));check(screen.getByText('本次课堂时间已到，进度已保留。'));assert.equal(f.starts,1);
});

test('close-related revision conflicts retry once with the same event ID',async()=>{
 const f=fixture(snapshot,{pauseOnStop:true}),baseFetch=globalThis.fetch;const endings:{eventId:string;expectedRevision:number}[]=[];
 let race=true;
 globalThis.fetch=async(input,init)=>{
  if(String(input).endsWith('/actions')&&typeof init?.body==='string'&&JSON.parse(init.body).type==='end'){
   const body=JSON.parse(init.body);endings.push(body);
   if(race){race=false;return Response.json({ok:false,error:{code:'STALE_REVISION',message:'课堂已经更新。'}},{status:409});}
  }
  return baseFetch(input,init);
 };
 render(<Classroom classroomId={snapshot.id} voiceFactory={f.voiceFactory} checkMicrophone={f.checkMicrophone}/>);
 await waitFor(()=>check(screen.getByRole('button',{name:'检查麦克风'})));fireEvent.click(screen.getByRole('button',{name:'检查麦克风'}));await waitFor(()=>check(!(screen.getByRole('button',{name:'开始上课'}) as HTMLButtonElement).disabled));fireEvent.click(screen.getByRole('button',{name:'开始上课'}));
 await waitFor(()=>check(screen.getByRole('button',{name:'结束课堂'})));fireEvent.click(screen.getByRole('button',{name:'结束课堂'}));fireEvent.click(screen.getByRole('button',{name:'结束并保存'}));
 await waitFor(()=>check(screen.getByRole('heading',{name:'这节课已保存'})));assert.equal(endings.length,2);assert.equal(endings[0].eventId,endings[1].eventId);check(!screen.queryByRole('alert'));
});

test('a close that reaches PostgreSQL shortly after the socket is reconciled without reopening media',async()=>{
 const f=fixture(),baseFetch=globalThis.fetch;let disconnected=false,reads=0;
 globalThis.fetch=async(input,init)=>{
  if(disconnected&&String(input)===`/api/v1/classrooms/${snapshot.id}`&&reads++===0)return Response.json({ok:true,classroom:{...snapshot,status:'active',revision:2}});
  return baseFetch(input,init);
 };
 render(<Classroom classroomId={snapshot.id} voiceFactory={f.voiceFactory} checkMicrophone={f.checkMicrophone}/>);
 await waitFor(()=>check(screen.getByRole('button',{name:'检查麦克风'})));fireEvent.click(screen.getByRole('button',{name:'检查麦克风'}));await waitFor(()=>check(!(screen.getByRole('button',{name:'开始上课'}) as HTMLButtonElement).disabled));fireEvent.click(screen.getByRole('button',{name:'开始上课'}));
 await waitFor(()=>assert.equal(f.starts,1));disconnected=true;f.disconnect({...snapshot,status:'ended',revision:3,endReason:'time_limit',endedAt:'2026-11-01T00:10:00Z',elapsedSeconds:600},'error');
 await waitFor(()=>check(screen.getByRole('heading',{name:'这节课已保存'})));assert.equal(f.starts,1);assert.equal(reads,2);
});
