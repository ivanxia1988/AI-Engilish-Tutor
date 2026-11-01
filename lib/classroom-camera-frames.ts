import {CLASSROOM_VISION_FRAME_MS,CLASSROOM_VISION_MAX_BASE64,CLASSROOM_VISION_MAX_HEIGHT,CLASSROOM_VISION_MAX_WIDTH} from './classroom-vision';

export type ClassroomCameraFramesDependencies={video():HTMLVideoElement;canvas():HTMLCanvasElement;every(callback:()=>void,milliseconds:number):unknown;cancel(timer:unknown):void};
export type ClassroomCameraFrameOwner=Pick<ClassroomCameraFrames,'start'|'stop'>;
export const CLASSROOM_CAMERA_FRAME_BASE64=24000;
/** Reads an existing camera stream. It never requests permission or stops the preview's tracks. */
export class ClassroomCameraFrames{
 private epoch=0;
 private video:HTMLVideoElement|null=null;
 private timer:unknown=null;
 private readonly dependencies:ClassroomCameraFramesDependencies;
 constructor(dependencies:Partial<ClassroomCameraFramesDependencies>={}){
  this.dependencies={video:()=>document.createElement('video'),canvas:()=>document.createElement('canvas'),every:(callback,ms)=>setInterval(callback,ms),cancel:timer=>clearInterval(timer as ReturnType<typeof setInterval>),...dependencies};
 }
 start(stream:MediaStream,onFrame:(image:string)=>void,onError:(message:string)=>void){
  this.stop();const epoch=++this.epoch,video=this.dependencies.video();this.video=video;video.muted=true;video.playsInline=true;video.srcObject=stream;
  let busy=false;const valid=()=>epoch===this.epoch;
  const fail=()=>{if(!valid())return;this.stop();onError('画面分享已停止，请重新开启；语音课堂可以继续。');};
  const capture=async()=>{
   if(!valid()||busy||video.readyState<2||!video.videoWidth||!video.videoHeight)return;
   if(!stream.getVideoTracks().some(track=>track.readyState==='live')){fail();return;}
   busy=true;
   try{
    const scale=Math.min(1,CLASSROOM_VISION_MAX_WIDTH/video.videoWidth,CLASSROOM_VISION_MAX_HEIGHT/video.videoHeight),canvas=this.dependencies.canvas();
    canvas.width=Math.max(1,Math.floor(video.videoWidth*scale));canvas.height=Math.max(1,Math.floor(video.videoHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('canvas');
    let blob:Blob|null=null;
    for(const [resize,quality] of [[1,.6],[1,.4],[1,.25],[.5,.5],[.5,.3]]){
     canvas.width=Math.max(1,Math.floor(video.videoWidth*scale*resize));canvas.height=Math.max(1,Math.floor(video.videoHeight*scale*resize));context.drawImage(video,0,0,canvas.width,canvas.height);
     blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(!valid())return;
     if(!blob||blob.type!=='image/jpeg')throw new Error('jpeg');
     if(blob.size<=CLASSROOM_CAMERA_FRAME_BASE64*.75)break;
    }
    if(!blob||blob.size>CLASSROOM_CAMERA_FRAME_BASE64*.75||blob.size>CLASSROOM_VISION_MAX_BASE64*.75)throw new Error('jpeg');
    const bytes=new Uint8Array(await blob.arrayBuffer());if(!valid())return;
    if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw new Error('jpeg');
    let binary='';for(let index=0;index<bytes.length;index+=8192)binary+=String.fromCharCode(...bytes.subarray(index,index+8192));
    const image=btoa(binary);if(image.length>CLASSROOM_CAMERA_FRAME_BASE64||image.length>CLASSROOM_VISION_MAX_BASE64)throw new Error('size');if(valid())onFrame(image);
   }catch{fail();}finally{busy=false;}
  };
  try{void Promise.resolve(video.play()).then(()=>{if(valid())this.timer=this.dependencies.every(()=>{void capture();},CLASSROOM_VISION_FRAME_MS);}).catch(fail);}catch{fail();}
 }
 stop(){
  this.epoch++;if(this.timer!==null)this.dependencies.cancel(this.timer);this.timer=null;
  if(this.video){this.video.pause();this.video.srcObject=null;this.video=null;}
 }
}
