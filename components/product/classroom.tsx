'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Check, Mic, MousePointer2, Pause, Pencil, PhoneOff, Play, RotateCcw, Undo2, Volume2, VolumeX, Wifi } from 'lucide-react';
import type { ClassroomAction, ClassroomSnapshot } from '../../lib/classroom-contract';
import type { Point } from '../../lib/types';
import { normalizedPoint, pointsBox, resolveSelection } from '../../lib/classroom';
import { PrototypeSounds } from '../../lib/prototype-sounds';
import {ClassroomCameraPreview,useClassroomCamera} from './classroom-camera';
import {TeacherStage} from './teacher-avatar';
import type {ClassroomVoiceFailure} from '../../lib/classroom-voice-errors';
import { AccountRequestError, accountRequest, errorMessage } from './account-request';
import { classroomResponse, classroomSnapshotSchema, navigateClassroom, readClassroom } from './classroom-request';

export type ClassroomVoiceHandle = {start():Promise<void>;stop():Promise<void>;dispose():void;setMuted(value:boolean):void;sendText(text:string):unknown};
export type VoiceFactory = (options:{classroomId:string;provider:'qwen'|'openai';onState:(state:'connecting'|'connected'|'closed'|'error')=>void;onSnapshot:(value:ClassroomSnapshot)=>void;onLevel:(role:'child'|'teacher',level:number)=>void;onError:(message:string)=>void;onFailure?:(failure:ClassroomVoiceFailure)=>void;onPlaybackQueue?:(milliseconds:number)=>void})=>ClassroomVoiceHandle;
type Props = {classroomId:string;voiceFactory:VoiceFactory;checkMicrophone?:(onLevel:(level:number)=>void,signal:AbortSignal)=>Promise<boolean>;navigate?:(path:string)=>void};
type Mark = {id:string;pageId:string;points:Point[]};
type Draft = {pointerId:number;stepId:string;points:Point[]};

export async function checkClassroomMicrophone(onLevel:(level:number)=>void,signal:AbortSignal):Promise<boolean>{
 if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前浏览器无法打开麦克风，请使用本机地址或 HTTPS。');
 if(signal.aborted)return false;
 const capture:{stream:MediaStream|null}={stream:null};let context:AudioContext|null=null,finished=false;
 let every:ReturnType<typeof setInterval>|undefined,sampling:ReturnType<typeof setTimeout>|undefined,startup:ReturnType<typeof setTimeout>|undefined;
 let cancel!:()=>void;
 const cancellation=new Promise<null>((resolve,reject)=>{cancel=()=>resolve(null);signal.addEventListener('abort',cancel,{once:true});startup=setTimeout(()=>reject(new Error('麦克风检查超时，请确认浏览器权限后重试。')),12000);});
 try{
  // Safari requires WebAudio activation within the check button's synchronous gesture.
  context=new AudioContext();const resuming=context.resume();
  const media=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false}).then(stream=>{
   if(finished||signal.aborted){stream.getTracks().forEach(track=>track.stop());return null;}
   capture.stream=stream;return stream;
  });
  const stream=await Promise.race([Promise.all([resuming,media]).then(([,value])=>value),cancellation]);
  if(!stream||signal.aborted)return false;
  if(startup)clearTimeout(startup);
  const analyser=context.createAnalyser();analyser.fftSize=512;context.createMediaStreamSource(stream).connect(analyser);const samples=new Uint8Array(analyser.fftSize);
  const measurement=new Promise<boolean>(resolve=>{
   let heard=false;every=setInterval(()=>{analyser.getByteTimeDomainData(samples);const level=Math.sqrt(samples.reduce((sum,value)=>sum+((value-128)/128)**2,0)/samples.length);heard ||= level>.012;onLevel(Math.min(1,level*8));},80);
   sampling=setTimeout(()=>resolve(heard),2500);
  });
  return (await Promise.race([measurement,cancellation]))??false;
 }finally{
  finished=true;if(startup)clearTimeout(startup);if(sampling)clearTimeout(sampling);if(every)clearInterval(every);signal.removeEventListener('abort',cancel);
  capture.stream?.getTracks().forEach(track=>track.stop());try{void context?.close().catch(()=>{});}catch{}onLevel(0);
 }
}
const time=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;

export function Classroom({classroomId,voiceFactory,checkMicrophone=checkClassroomMicrophone,navigate=navigateClassroom}:Props){
 const [snapshot,setSnapshot]=useState<ClassroomSnapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState(false);
 const [voiceFailure,setVoiceFailure]=useState<ClassroomVoiceFailure|null>(null),[playbackQueue,setPlaybackQueue]=useState(0);
 const [mic,setMic]=useState<'unchecked'|'checking'|'passed'|'failed'>('unchecked'),[micLevel,setMicLevel]=useState(0),[voiceState,setVoiceState]=useState<'idle'|'connecting'|'connected'|'closed'|'error'>('idle');
 const [levels,setLevels]=useState({child:0,teacher:0}),[tool,setTool]=useState<'pointer'|'pen'>('pointer'),[marks,setMarks]=useState<Mark[]>([]),[draft,setDraft]=useState<Draft|null>(null),[endDialog,setEndDialog]=useState(false),[reward,setReward]=useState(false),[sound,setSound]=useState(true),[notice,setNotice]=useState('');
 const camera=useClassroomCamera(classroomId,!!snapshot&&snapshot.status!=='paused'&&snapshot.status!=='ended'&&!endDialog);
 const stopCamera=camera.stop;
 const mounted=useRef(false),current=useRef<ClassroomSnapshot|null>(null),ended=useRef(false),locked=useRef(false),voice=useRef<ClassroomVoiceHandle|null>(null),voiceEpoch=useRef(0),disconnectRead=useRef<{epoch:number;controller:AbortController}|null>(null),micController=useRef<AbortController|null>(null),draftRef=useRef<Draft|null>(null),seenFeedback=useRef(new Set<string>()),rewardTimer=useRef<ReturnType<typeof setTimeout>|null>(null),continueButton=useRef<HTMLButtonElement>(null),soundEnabled=useRef(true),sounds=useRef(new PrototypeSounds());
 const stopMedia=useCallback(async()=>{
  stopCamera();voiceEpoch.current++;disconnectRead.current?.controller.abort();disconnectRead.current=null;const previous=voice.current;voice.current=null;setLevels({child:0,teacher:0});setPlaybackQueue(0);setVoiceState('closed');sounds.current?.stop();setReward(false);
  if(previous){try{await previous.stop();}finally{previous.dispose();}}
 },[stopCamera]);
 const accept=useCallback((value:ClassroomSnapshot,initial=false)=>{
  const parsed=classroomSnapshotSchema.safeParse(value);if(!parsed.success||!mounted.current||value.id!==classroomId||ended.current)return;
  if(current.current&&value.revision<current.current.revision)return;
  if(current.current?.stepIndex!==value.stepIndex||current.current?.status!==value.status){draftRef.current=null;setDraft(null);setNotice('');}
  current.current=value;setSnapshot(value);
  if(initial){setSound(value.preferences.soundEffects);soundEnabled.current=value.preferences.soundEffects;}
  if(value.status==='ended'){ended.current=true;micController.current?.abort();void stopMedia();setEndDialog(false);return;}
  const feedback=value.feedback;
  if(feedback&&!seenFeedback.current.has(feedback.id)){
   seenFeedback.current.add(feedback.id);
   if(!initial&&feedback.kind==='correct'){
    setReward(true);if(rewardTimer.current)clearTimeout(rewardTimer.current);rewardTimer.current=setTimeout(()=>setReward(false),2200);
    if(soundEnabled.current)void sounds.current?.play('correct');
   }
  }
 },[classroomId,stopMedia]);
 useEffect(()=>{
  mounted.current=true;const controller=new AbortController();
  readClassroom(classroomId,controller.signal).then(result=>{if(controller.signal.aborted)return;accept(result.classroom,true);setLoading(false);}).catch(failure=>{if(controller.signal.aborted)return;if(failure instanceof AccountRequestError&&failure.status===401){navigate('/login');return;}setError(errorMessage(failure));setLoading(false);});
  return()=>{mounted.current=false;controller.abort();micController.current?.abort();disconnectRead.current?.controller.abort();voiceEpoch.current++;voice.current?.dispose();voice.current=null;if(rewardTimer.current)clearTimeout(rewardTimer.current);sounds.current?.stop();};
 },[classroomId,attempt,accept,navigate]);
 useEffect(()=>()=>{sounds.current?.dispose();},[]);
 useEffect(()=>{if(snapshot?.status==='paused'&&voice.current)void stopMedia();},[snapshot?.status,stopMedia]);
 useEffect(()=>{
  if(!snapshot||snapshot.status==='ended')return;
  const leave=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);
 },[snapshot?.status]);
 useEffect(()=>{if(endDialog)continueButton.current?.focus();},[endDialog]);
 async function reload(){const result=await readClassroom(classroomId);accept(result.classroom);return result.classroom;}
 function syncDisconnected(epoch:number){
  if(disconnectRead.current?.epoch===epoch)return;
  disconnectRead.current?.controller.abort();const controller=new AbortController();disconnectRead.current={epoch,controller};
  const valid=()=>mounted.current&&!ended.current&&voiceEpoch.current===epoch&&!controller.signal.aborted;
  void(async()=>{
   for(const delay of [0,200,500,1000]){
    if(delay)await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,delay);controller.signal.addEventListener('abort',finish,{once:true});});
    if(!valid())return;
    try{
     const result=await readClassroom(classroomId,AbortSignal.any([controller.signal,AbortSignal.timeout(2500)]));
     if(!valid())return;accept(result.classroom);
     if(result.classroom.status!=='active')return;
    }catch(failure){if(!valid())return;if(failure instanceof AccountRequestError&&failure.status===401){navigate('/login');return;}}
   }
  })();
 }
 async function action(type:ClassroomAction['type'],objectIds?:string[]){
  const state=current.current;if(!state||ended.current||locked.current)return null;locked.current=true;setBusy(true);setError('');setNotice('');
  const eventId=crypto.randomUUID(),closing=type==='pause'||type==='end';let target=state;
  const refreshed=async()=>{target=await reload();return target.status==='ended'||(type==='pause'&&target.status==='paused');};
  try{
   if(closing){await stopMedia();if(await refreshed())return target;}
   for(let retry=0;retry<2;retry++){
    try{
     const result=await accountRequest(`/classrooms/${classroomId}/actions`,classroomResponse,{body:{eventId,expectedRevision:target.revision,type,...(objectIds?{objectIds}:{})}});
     accept(result.classroom);return result.classroom;
    }catch(failure){
     if(!closing||retry>0||!(failure instanceof AccountRequestError)||failure.status!==409)throw failure;
     if(await refreshed())return target;
    }
   }
   return null;
  }catch(failure){if(mounted.current){setError(errorMessage(failure));try{await reload();}catch{ /* Keep the last confirmed state visible. */ }}return null;}
  finally{locked.current=false;if(mounted.current)setBusy(false);}
 }
 function connect(){
  const state=current.current;if(!state||ended.current||voice.current||locked.current||mic!=='passed')return;
  setError('');setVoiceFailure(null);setNotice('');disconnectRead.current?.controller.abort();disconnectRead.current=null;const epoch=++voiceEpoch.current;
  try{
   if(soundEnabled.current)void sounds.current?.play('hint');
   const client=voiceFactory({classroomId,provider:state.preferences.provider,onState:value=>{if(mounted.current&&epoch===voiceEpoch.current&&!ended.current){setVoiceState(value);if(value==='closed'||value==='error'){camera.stop();voice.current?.dispose();voice.current=null;syncDisconnected(epoch);}}},onSnapshot:value=>{if(epoch===voiceEpoch.current)accept(value);},onLevel:(role,level)=>{if(mounted.current&&epoch===voiceEpoch.current&&!ended.current)setLevels(previous=>({...previous,[role]:level}));},onError:message=>{if(mounted.current&&epoch===voiceEpoch.current&&!ended.current)setError(message);},onFailure:failure=>{if(mounted.current&&epoch===voiceEpoch.current&&!ended.current)setVoiceFailure(failure);},onPlaybackQueue:milliseconds=>{if(mounted.current&&epoch===voiceEpoch.current&&!ended.current)setPlaybackQueue(milliseconds);}});
   voice.current=client;setVoiceState('connecting');
   void client.start().catch(failure=>{if(mounted.current&&epoch===voiceEpoch.current&&!ended.current){setError(errorMessage(failure));setVoiceState('error');client.dispose();voice.current=null;syncDisconnected(epoch);}});
  }catch(failure){setError(errorMessage(failure));setVoiceState('error');voice.current?.dispose();voice.current=null;}
 }
 async function check(){
  if(mic==='checking'||ended.current)return;micController.current?.abort();const controller=new AbortController();micController.current=controller;setMic('checking');setError('');
  try{const heard=await checkMicrophone(value=>{if(!controller.signal.aborted&&mounted.current)setMicLevel(value);},controller.signal);if(controller.signal.aborted||!mounted.current)return;setMic(heard?'passed':'failed');if(!heard)setError('还没有听到声音，请靠近麦克风说一句 Hello，再检查一次。');}
  catch(failure){if(!controller.signal.aborted&&mounted.current){setMic('failed');setError(failure instanceof DOMException&&failure.name==='NotAllowedError'?'请允许浏览器使用麦克风，再重新检查。':errorMessage(failure));}}
 }
 function startDraw(event:PointerEvent<SVGSVGElement>){
  if(tool!=='pen'||busy||voiceState!=='connected'||current.current?.status!=='active')return;
  const state=current.current,step=state.course.steps[state.stepIndex];if(!step)return;
  const value:Draft={pointerId:event.pointerId,stepId:step.id,points:[normalizedPoint(event.clientX,event.clientY,event.currentTarget.getBoundingClientRect())]};draftRef.current=value;setDraft({...value});event.currentTarget.setPointerCapture?.(event.pointerId);event.preventDefault();
 }
 function moveDraw(event:PointerEvent<SVGSVGElement>){const value=draftRef.current;if(!value||value.pointerId!==event.pointerId)return;value.points.push(normalizedPoint(event.clientX,event.clientY,event.currentTarget.getBoundingClientRect()));if(value.points.length>600)value.points.splice(1,1);setDraft({...value,points:[...value.points]});}
 function finishDraw(event:PointerEvent<SVGSVGElement>){
  const value=draftRef.current;draftRef.current=null;setDraft(null);if(!value||value.pointerId!==event.pointerId||current.current?.status!=='active'||voiceState!=='connected')return;
  const state=current.current,step=state.course.steps[state.stepIndex];if(!step||step.id!==value.stepId)return;
  const page=state.course.pages.find(item=>item.id===step.pageId);if(!page)return;
  setMarks(previous=>[...previous,{id:crypto.randomUUID(),pageId:page.id,points:value.points}].slice(-100));
  const box=pointsBox(value.points),closed=value.points.length>=8&&box.w>.035&&box.h>.035&&Math.hypot(value.points[0].x-value.points.at(-1)!.x,value.points[0].y-value.points.at(-1)!.y)<.065;
  if(!closed||step.kind!=='select')return;
  const selection=resolveSelection(value.points,page.objects,'pen');
  if(selection.status==='selected'&&selection.ids.length===1)void action('select',selection.ids);else setNotice(selection.status==='ambiguous'?'圈到不止一个了，试着只圈一个。':'这个圈里还没有找到图片。');
 }
 const state=snapshot,step=state?.course.steps[state.stepIndex],page=state?.course.pages.find(item=>item.id===step?.pageId)??state?.course.pages[0];
 const live=state?.status==='active'&&voiceState==='connected'&&!busy;
 const teacherTalking=levels.teacher>.008,childTalking=levels.child>.015;
 const preflight=!!state&&(state.status==='preflight'||(state.status==='active'&&voiceState!=='connected'&&voiceState!=='connecting'));
 const blocked=endDialog||state?.status==='paused'||preflight;
 if(loading)return <main className="tk-product tk-real-classroom"><p className="tk-class-loading" role="status">正在读取课堂…</p></main>;
 if(!state)return <main className="tk-product tk-real-classroom"><section className="tk-class-loading"><p className="tk-account-error" role="alert">{error||'课堂暂时无法读取。'}</p><button type="button" className="tk-submit" onClick={()=>{setLoading(true);setAttempt(value=>value+1);}}>重新读取</button><Link href="/courses">回到我的课程</Link></section></main>;
 if(state.status==='ended')return <main className="tk-product tk-real-summary"><header className="tk-product-header"><Link href="/courses" className="tk-wordmark">Tee<span>ko</span></Link><span>本次小结</span></header><section><img src="/prototype-assets/pose-celebrate.svg" alt="Teeko"/><h1>这节课已保存</h1><p>{state.course.title}</p><div className="tk-real-summary-stats"><div><strong>{time(state.elapsedSeconds)}</strong><span>本次课堂时长</span></div><div><strong>{state.outcomes.filter(item=>item.status==='independent').length}</strong><span>独立完成</span></div><div><strong>{state.outcomes.filter(item=>item.status==='assisted').length}</strong><span>提示后完成</span></div></div><p className="tk-summary-note">{state.endReason==='content_completed'?'本课内容已结束。':state.endReason==='time_limit'?'本次课堂时间已到，进度已保留。':state.endReason==='daily_limit'?'今日练习时间已用完，进度已保留。':'下次可以从保留的进度继续。'}</p><p className="tk-summary-note">详细报告暂未开放。</p><Link className="tk-submit" href="/courses">回到我的课程<ArrowRight size={18}/></Link></section></main>;
 return <main className="tk-product tk-real-classroom">
  <header className="tk-real-class-header" aria-hidden={blocked||undefined} inert={blocked}><BookOpen size={20}/><strong>{state.course.title}</strong><span>{state.course.subtitle}</span><time aria-label="已上课时间">{time(state.elapsedSeconds)}</time></header>
  <div className="tk-real-call-body" aria-hidden={blocked||undefined} inert={blocked}><section className="tk-real-book-area" aria-label="教材">
   {page&&<div className="tk-real-paper" style={{aspectRatio:`${page.width}/${page.height}`}}><img src={page.image} alt={state.course.title} draggable={false}/>
    <div className="tk-real-hotspots">{page.objects.map(object=><button key={object.id} type="button" className={state.teacherObjectIds.includes(object.id)?'is-highlighted':''} aria-label={`选择 ${object.label}`} disabled={!live||step?.kind!=='select'||tool==='pen'} style={{left:`${object.box.x*100}%`,top:`${object.box.y*100}%`,width:`${object.box.w*100}%`,height:`${object.box.h*100}%`}} onClick={()=>{void action('select',[object.id]);}}/>)}</div>
    <svg className={`tk-real-annotation is-${tool}`} viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="none" aria-label="教材标注区域" role="img" onPointerDown={startDraw} onPointerMove={moveDraw} onPointerUp={finishDraw} onPointerCancel={()=>{draftRef.current=null;setDraft(null);}}>
     {state.teacherObjectIds.map(id=>{const object=page.objects.find(item=>item.id===id);return object?<ellipse key={id} cx={(object.box.x+object.box.w/2)*page.width} cy={(object.box.y+object.box.h/2)*page.height} rx={object.box.w*page.width*.56} ry={object.box.h*page.height*.56} fill="none" stroke="#19877b" strokeWidth={4}/>:null;})}
     {[...marks.filter(mark=>mark.pageId===page.id),...(draft?[{id:'draft',pageId:page.id,points:draft.points}]:[])].map(mark=><polyline key={mark.id} points={mark.points.map(point=>`${point.x*page.width},${point.y*page.height}`).join(' ')} fill="none" stroke="#e87b52" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"/>)}
    </svg>
    {reward&&<div className="tk-real-fireworks" aria-hidden="true">{Array.from({length:16},(_,index)=><i key={index} style={{'--spark-angle':`${index*22.5}deg`,'--spark-color':['#e77838','#e4b64d','#239a8d','#7a87c8'][index%4]} as CSSProperties}/>)}</div>}
   </div>}
   <div className="tk-real-task"><div><strong>{step?.english??'Let’s talk.'}</strong><span role="status">{notice||state.feedback?.message||'可以开口，也可以点选或画圈。'}</span></div><div><button type="button" disabled={!live} onClick={()=>{void action('hint');}}>提示一下</button><button type="button" disabled={!live} onClick={()=>{void action(step?.kind==='listen'?'next':'skip');}}>{step?.kind==='listen'?'继续':'换一题'}<ArrowRight size={16}/></button></div></div>
  </section><aside className="tk-real-call-rail">
   <section className={`tk-real-video-tile tk-real-teacher ${teacherTalking?'is-speaking':''}`}><div className="tk-real-connection"><Wifi size={14}/>{voiceState==='connected'?'已连接':voiceState==='connecting'?'连接中':'未连接'}</div><TeacherStage level={levels.teacher} connected={voiceState==='connected'&&state.status==='active'} childSpeaking={childTalking} celebrating={reward} allowHandoff={state.preferences.provider==='openai'||playbackQueue<=0}/><footer><strong>Teeko 老师</strong><span>{teacherTalking?'正在说话':voiceState==='connected'?'正在听你说':state.status==='paused'?'已暂停':'等待连接'}</span><div className="tk-real-level" aria-label="老师声音">{[.35,.7,1,.55].map((scale,index)=><i key={index} style={{height:`${5+Math.min(1,levels.teacher*10)*scale*19}px`}}/>)}</div></footer></section>
   <section className={`tk-real-video-tile tk-real-child ${childTalking?'is-speaking':''}`}><div className="tk-real-connection"><Mic size={14}/>{mic==='passed'?'麦克风可用':mic==='checking'?'正在检查':'未检查'}</div><div className="tk-real-child-stage">{!preflight&&<ClassroomCameraPreview camera={camera} name={state.profile.name}/>}</div><footer><strong>{state.profile.name}</strong><span>{childTalking?'正在说话':voiceState==='connected'?'可以直接开口':'等待开始'}</span><Mic size={17}/></footer></section>
  </aside></div>
  {error&&!preflight&&!endDialog&&state.status!=='paused'&&<div className="tk-real-error" role="alert">{error}{voiceState==='error'||voiceState==='closed'?<button type="button" disabled={busy} onClick={()=>{void action('resume').then(result=>{if(result)setVoiceState('idle');});}}>准备重新连接</button>:null}</div>}
  <footer className="tk-real-controls" aria-hidden={blocked||undefined} inert={blocked}><div className="tk-real-tools"><button type="button" aria-label="指针" aria-pressed={tool==='pointer'} disabled={!live} onClick={()=>setTool('pointer')}><MousePointer2 size={20}/></button><button type="button" aria-label="画笔" aria-pressed={tool==='pen'} disabled={!live} onClick={()=>setTool('pen')}><Pencil size={20}/></button><button type="button" aria-label="撤销笔迹" disabled={!live||!marks.length} onClick={()=>setMarks(value=>value.slice(0,-1))}><Undo2 size={20}/></button></div><div className="tk-real-main-controls"><button type="button" aria-label={sound?'关闭互动音效':'开启互动音效'} aria-pressed={sound} onClick={()=>{const next=!sound;setSound(next);soundEnabled.current=next;if(!next)sounds.current?.stop();}}>{sound?<Volume2 size={20}/>:<VolumeX size={20}/>}</button><button type="button" aria-label="暂停课堂" disabled={busy||voiceState!=='connected'} onClick={()=>{void action('pause');}}><Pause size={18}/>暂停</button><button type="button" className="tk-real-end" aria-label="结束课堂" disabled={busy} onClick={()=>setEndDialog(true)}><PhoneOff size={18}/>结束</button></div></footer>
  {preflight&&voiceState!=='connecting'&&!endDialog&&<div className="tk-real-scrim"><section className="tk-real-preflight" aria-label="准备上课"><div className="tk-real-preflight-art"><ClassroomCameraPreview camera={camera} name={state.profile.name}/></div><div><h1>准备上课</h1><p>声音用于实时对话。摄像头可选，点击开启后由浏览器确认权限，画面仅在本机预览。</p><button className="tk-real-check" type="button" disabled={mic==='checking'} onClick={()=>{void check();}}>{mic==='passed'?<Check size={20}/>:<Mic size={20}/>}<span>{mic==='checking'?'请说一句 Hello…':mic==='passed'?'麦克风检查通过':'检查麦克风'}</span>{mic==='checking'&&<meter min={0} max={1} value={micLevel} aria-label="麦克风音量"/>}</button>{error&&<p className="tk-account-error" role="alert">{error}</p>}{(voiceState==='error'||voiceState==='closed')&&<button type="button" className="tk-real-check" disabled={busy} onClick={()=>{void action('resume').then(result=>{if(result)setVoiceState('idle');});}}>准备重新连接<RotateCcw size={16}/></button>}<button type="button" className="tk-submit" disabled={mic!=='passed'||busy||voiceState==='error'||voiceState==='closed'} onClick={connect}>开始上课<ArrowRight size={18}/></button><Link className="tk-real-back" href="/courses">回到我的课程</Link></div></section></div>}
  {voiceState==='connecting'&&!endDialog&&<div className="tk-real-connecting"><span role="status">正在连接老师…</span><button type="button" onClick={()=>{void stopMedia().then(reload).catch(failure=>setError(errorMessage(failure)));}}>取消连接</button></div>}
  {state.status==='paused'&&!endDialog&&<div className="tk-real-scrim"><section className="tk-real-pause" role="dialog" aria-modal="true" aria-label="课堂已暂停"><Pause size={24}/><h2>{voiceFailure?'课堂连接中断':'已暂停'}</h2>{voiceFailure&&<p role="alert" data-voice-failure={voiceFailure.code}>{voiceFailure.message}</p>}<div><button type="button" className="tk-submit" disabled={busy} onClick={()=>{void action('resume').then(result=>{if(result){setVoiceState('idle');setVoiceFailure(null);setError('');}});}}><Play size={18}/>继续上课</button><button type="button" disabled={busy} onClick={()=>setEndDialog(true)}>结束课堂</button></div></section></div>}
  {endDialog&&<div className="tk-real-scrim"><section className="tk-real-pause" role="dialog" aria-modal="true" aria-label="结束确认" onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.preventDefault();setEndDialog(false);}if(event.key==='Tab'){const buttons=event.currentTarget.querySelectorAll<HTMLButtonElement>('button');const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}}><h2>今天就学到这里？</h2><p>结束后保留本次进度。</p><div><button type="button" className="tk-submit" ref={continueButton} disabled={busy} onClick={()=>setEndDialog(false)}>继续上课</button><button type="button" className="tk-real-danger" disabled={busy} onClick={()=>{void action('end');}}>结束并保存</button></div></section></div>}
 </main>;
}
