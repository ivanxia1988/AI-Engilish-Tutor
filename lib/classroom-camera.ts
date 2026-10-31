export type ClassroomCameraState = {status:'off'|'requesting'|'on'|'denied'|'error';stream:MediaStream|null;message:string};
type CameraMedia=(constraints:MediaStreamConstraints)=>Promise<MediaStream>;

/** Optional local preview only: no audio capture, upload, recording or permission on construction. */
export class ClassroomCamera {
 state:ClassroomCameraState={status:'off',stream:null,message:''};
 private epoch=0;
 private disposed=false;
 private cancel:(()=>void)|null=null;
 private detach:(()=>void)|null=null;
 constructor(private readonly changed:(state:ClassroomCameraState)=>void,private readonly media:CameraMedia=constraints=>{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('unavailable');
  return navigator.mediaDevices.getUserMedia(constraints);
 }){}
 private publish(state:ClassroomCameraState){this.state=state;if(!this.disposed)this.changed(state);}
 async start(){
  if(this.disposed||this.state.status==='requesting'||this.state.status==='on')return;
  const epoch=++this.epoch;this.publish({status:'requesting',stream:null,message:'请在浏览器中允许使用摄像头。'});
  let timer:ReturnType<typeof setTimeout>|undefined;
  let cancel!:()=>void;
  const cancellation=new Promise<null>((resolve,reject)=>{cancel=()=>resolve(null);timer=setTimeout(()=>reject(new Error('timeout')),12000);});this.cancel=cancel;
  try{
   const pending=this.media({audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480}}}).then(stream=>{
    if(this.disposed||epoch!==this.epoch){stream.getTracks().forEach(track=>track.stop());return null;}
    return stream;
   });
   const stream=await Promise.race([pending,cancellation]);
   if(!stream)return;
   if(this.disposed||epoch!==this.epoch){stream.getTracks().forEach(track=>track.stop());return;}
   const tracks=stream.getVideoTracks();
   if(!tracks.length){stream.getTracks().forEach(track=>track.stop());throw new Error('unavailable');}
   const ended=()=>{if(epoch===this.epoch){this.stop();this.publish({status:'off',stream:null,message:'摄像头已关闭，可以继续语音上课。'});}};
   tracks.forEach(track=>track.addEventListener('ended',ended));
   this.detach=()=>tracks.forEach(track=>track.removeEventListener('ended',ended));
   this.publish({status:'on',stream,message:''});
  }catch(error){
   if(this.disposed||epoch!==this.epoch)return;
   this.epoch++;
   const denied=error instanceof Error&&error.name==='NotAllowedError';
   const message=denied?'摄像头未获授权。可在浏览器的网站权限中允许后重试，也可以只用语音上课。':error instanceof Error&&error.message==='timeout'?'等待摄像头授权超时。确认浏览器权限后可重试。':'暂时无法使用摄像头，请检查设备和浏览器权限，也可以只用语音上课。';
   this.publish({status:denied?'denied':'error',stream:null,message});
  }finally{if(timer)clearTimeout(timer);if(this.cancel===cancel)this.cancel=null;}
 }
 stop(){
  this.epoch++;this.cancel?.();this.cancel=null;this.detach?.();this.detach=null;
  this.state.stream?.getTracks().forEach(track=>track.stop());this.publish({status:'off',stream:null,message:''});
 }
 dispose(){this.disposed=true;this.stop();}
}
