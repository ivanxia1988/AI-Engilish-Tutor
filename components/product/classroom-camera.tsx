'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Camera,CameraOff} from 'lucide-react';
import {ClassroomCamera,type ClassroomCameraState} from '../../lib/classroom-camera';

export function useClassroomCamera(classroomId:string,enabled:boolean){
 const [entry,setEntry]=useState<{id:string;value:ClassroomCameraState}>({id:classroomId,value:{status:'off',stream:null,message:''}});
 const state:ClassroomCameraState=entry.id===classroomId?entry.value:{status:'off',stream:null,message:''};
 const owner=useRef<ClassroomCamera|null>(null);
 useEffect(()=>{const camera=new ClassroomCamera(value=>setEntry({id:classroomId,value}));owner.current=camera;return()=>{owner.current=null;camera.dispose();};},[classroomId]);
 useEffect(()=>{if(!enabled)owner.current?.stop();},[enabled,classroomId]);
 const stop=useCallback(()=>owner.current?.stop(),[]);
 const toggle=useCallback(()=>{if(!enabled)return;const camera=owner.current;if(!camera)return;if(camera.state.status==='on'||camera.state.status==='requesting')camera.stop();else void camera.start();},[enabled]);
 return{state,stop,toggle,enabled};
}
export function ClassroomCameraPreview({camera,name}:{camera:ReturnType<typeof useClassroomCamera>;name:string}){
 const video=useRef<HTMLVideoElement>(null);
 useEffect(()=>{const element=video.current;if(!element)return;element.srcObject=camera.state.stream;return()=>{element.srcObject=null;};},[camera.state.stream]);
 const on=camera.state.status==='on',requesting=camera.state.status==='requesting';
 return <div className={`tk-camera-preview ${on?'is-on':''}`}>
  {on?<video ref={video} autoPlay muted playsInline aria-label={`${name}的摄像头预览`}/>:<><span className="tk-real-child-avatar">{Array.from(name.trim())[0]?.toUpperCase()||'T'}</span><small><CameraOff size={14}/>{requesting?'等待浏览器授权':'摄像头未开启'}</small></>}
  <button type="button" className="tk-camera-toggle" disabled={!camera.enabled} onClick={camera.toggle} aria-pressed={on} aria-label={on?'关闭摄像头':requesting?'取消摄像头授权':'开启摄像头'}>{on?<CameraOff size={15}/>:<Camera size={15}/>} {on?'关闭摄像头':requesting?'取消':'开启摄像头'}</button>
  {camera.state.message&&!requesting&&<p className="tk-camera-message" role="status">{camera.state.message}</p>}
 </div>;
}
