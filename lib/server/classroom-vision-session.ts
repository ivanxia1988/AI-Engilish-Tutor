import {CLASSROOM_VISION_MAX_BASE64,CLASSROOM_VISION_MAX_WIDTH,CLASSROOM_VISION_MAX_HEIGHT,CLASSROOM_VISION_OPENAI_INTERVAL_MS,type ClassroomVisionObserver,type ClassroomVisionObservation,type ClassroomVisionState} from '../classroom-vision';

/** Header inspection only; the provider decodes bounded JPEG, never arbitrary URLs or files. */
export function decodeClassroomVisionJpeg(image:unknown):{width:number;height:number}|null{
 if(typeof image!=='string'||!image||image.length>CLASSROOM_VISION_MAX_BASE64||image.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(image))return null;
 const bytes=Buffer.from(image,'base64');
 if(bytes.toString('base64')!==image||bytes.length<12||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)return null;
 let offset=2;
 while(offset+4<=bytes.length){
  if(bytes[offset++]!==255)return null;
  while(bytes[offset]===255)offset++;
  const marker=bytes[offset++];if(marker===217||marker===218)return null;
  if(marker===1||marker>=208&&marker<=215)continue;
  const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)return null;
  if([192,193,194].includes(marker)){
   if(length<8)return null;
   const height=bytes.readUInt16BE(offset+3),width=bytes.readUInt16BE(offset+5);
   return width>0&&height>0&&width<=CLASSROOM_VISION_MAX_WIDTH&&height<=CLASSROOM_VISION_MAX_HEIGHT?{width,height}:null;
  }
  offset+=length;
 }
 return null;
}

type Dependencies={
 provider:'qwen'|'openai';now?:()=>number;
 context:()=>{key:string;objective:string};authorize:()=>Promise<boolean>;
 canSendQwen:()=>boolean;sendQwen:(image:string)=>boolean;
 status:(state:ClassroomVisionState)=>void;sharingChanged:(sharing:boolean)=>void;
 observed:(observation:ClassroomVisionObservation,first:boolean)=>void;
 invalidated?:()=>void;observe?:ClassroomVisionObserver;
};
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=2_000_000_000;
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).length===allowed.length&&Object.keys(value).every(key=>allowed.includes(key));
const OBSERVATION_TTL=8000;

/** One authenticated connection owns image routing; no image or observation is persisted. */
export class ClassroomVisionSession{
 private active=false;private closed=false;private generation=0;private sequence=0;
 private lastFrameAt=-Infinity;private lastSentAt=-Infinity;private nextObservationAt=-Infinity;private firstObservation=true;
 private request:AbortController|null=null;private expiry:ReturnType<typeof setTimeout>|null=null;
 private readonly now:()=>number;
 constructor(private readonly deps:Dependencies){this.now=deps.now??Date.now;}
 get sharing(){return this.active&&!this.closed;}
 private publish(status:ClassroomVisionState['status'],message?:string){if(!this.closed)this.deps.status({status,generation:this.generation,...(message?{message}:{})});}
 private clear(){this.request?.abort();this.request=null;if(this.expiry)clearTimeout(this.expiry);this.expiry=null;}
 private off(status:ClassroomVisionState['status']='off',message?:string){this.active=false;this.clear();this.deps.invalidated?.();this.deps.sharingChanged(false);this.publish(status,message);}
 private failure(){this.off('error','画面暂时无法分享，语音仍可继续。请重试。');}
 async handle(raw:Record<string,unknown>){
  if(this.closed)return;
  if(raw.type==='vision.start'){
   if(!keys(raw,['type','generation'])||!integer(raw.generation)||raw.generation<=this.generation)return;
   this.clear();this.deps.invalidated?.();this.generation=raw.generation;this.sequence=0;this.firstObservation=true;
   if(this.deps.provider==='openai'&&!this.deps.observe){this.off('unavailable','视觉服务暂不可用，仍可语音上课。');return;}
   this.active=true;this.deps.sharingChanged(true);this.publish('starting');return;
  }
  if(raw.type==='vision.stop'){
   if(keys(raw,['type','generation'])&&raw.generation===this.generation)this.off();return;
  }
  if(raw.type!=='vision.frame'||!this.active||raw.generation!==this.generation)return;
  if(!keys(raw,['type','generation','sequence','image'])||!integer(raw.sequence)||!decodeClassroomVisionJpeg(raw.image)){this.failure();return;}
  if(raw.sequence<=this.sequence)return;
  this.sequence=raw.sequence;
  const receivedAt=this.now();if(receivedAt-this.lastFrameAt<950)return;this.lastFrameAt=receivedAt;
  const generation=this.generation,context=this.deps.context();
  const current=()=>this.active&&!this.closed&&generation===this.generation&&raw.sequence===this.sequence&&context.key===this.deps.context().key&&this.now()-receivedAt<OBSERVATION_TTL;
  let authorized=false;try{authorized=await this.deps.authorize();}catch{if(current())this.failure();return;}
  if(!current())return;
  if(!authorized){this.off();return;}
  const sentAt=this.now();if(sentAt-this.lastSentAt<950)return;
  const image=raw.image as string;
  if(this.deps.provider==='qwen'){
   if(!this.deps.canSendQwen())return;
   if(!this.deps.sendQwen(image)){this.failure();return;}
   this.lastSentAt=sentAt;this.publish('sharing');return;
  }
  if(this.request||sentAt<this.nextObservationAt)return;
  this.lastSentAt=sentAt;this.nextObservationAt=sentAt+CLASSROOM_VISION_OPENAI_INTERVAL_MS;
  const controller=new AbortController();this.request=controller;
  void this.deps.observe!({image,contextKey:context.key,objective:context.objective},controller.signal).then(async observation=>{
   if(controller.signal.aborted||this.closed||!this.active||generation!==this.generation||context.key!==this.deps.context().key||this.now()-receivedAt>=OBSERVATION_TTL)return;
   const authorized=await this.deps.authorize();
   if(controller.signal.aborted||this.closed||!this.active||generation!==this.generation||context.key!==this.deps.context().key||this.now()-receivedAt>=OBSERVATION_TTL)return;
   if(!authorized){this.off();return;}
   if(typeof observation.visible!=='boolean'||typeof observation.description!=='string'||!observation.description.trim()||observation.description.length>300){this.failure();return;}
   const first=this.firstObservation;this.firstObservation=false;
   this.deps.observed(observation,first);this.publish('sharing');
   if(this.expiry)clearTimeout(this.expiry);
   this.expiry=setTimeout(()=>{this.expiry=null;if(!this.closed&&this.active&&generation===this.generation){this.deps.invalidated?.();this.publish('starting');}},Math.max(0,OBSERVATION_TTL-(this.now()-receivedAt)));this.expiry.unref?.();
  }).catch(()=>{if(!controller.signal.aborted&&!this.closed&&this.active&&generation===this.generation)this.failure();}).finally(()=>{if(this.request===controller)this.request=null;});
 }
 imageRejected(){if(this.active&&!this.closed)this.failure();}
 contextChanged(){if(!this.active||this.closed)return;this.clear();this.deps.invalidated?.();this.publish('starting');}
 close(){this.clear();this.active=false;this.closed=true;}
}
