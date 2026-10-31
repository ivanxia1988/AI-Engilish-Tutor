'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {TeacherAvatarMotion,type TeacherAvatarInput,type TeacherAvatarVisual} from './teacher-avatar-state';

export type TeacherAvatarProps = TeacherAvatarInput & {className?:string};

export function TeacherAvatar({level,connected,childSpeaking,celebrating,paused=false,allowHandoff=true,className=''}:TeacherAvatarProps){
 const [visual,setVisual]=useState<TeacherAvatarVisual>({mouth:'closed',handingOff:false});
 const input=useRef<TeacherAvatarInput>({level,connected,childSpeaking,celebrating,paused,allowHandoff}),motion=useRef(new TeacherAvatarMotion());
 const rigId=useId().replace(/[^a-zA-Z0-9_-]/g,''),bodyClip=`${rigId}-body`,headClip=`${rigId}-head`;
 useEffect(()=>{input.current={level,connected,childSpeaking,celebrating,paused,allowHandoff};},[level,connected,childSpeaking,celebrating,paused,allowHandoff]);
 useEffect(()=>{
  if(typeof requestAnimationFrame!=='function')return;
  let frame=0;
  const tick=(now:number)=>{const next=motion.current.sample(input.current,now);setVisual(previous=>previous.mouth===next.mouth&&previous.handingOff===next.handingOff?previous:next);frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[]);
 const active=connected&&!paused,mouth=active?visual.mouth:'closed',handingOff=active&&!childSpeaking&&!celebrating&&allowHandoff&&visual.handingOff;
 return <div className={`tk-teacher-avatar ${className}`} data-mouth={mouth} data-handoff={String(handingOff)} data-celebrating={String(celebrating)} role="img" aria-label={handingOff?'Teeko 老师，轮到你开口':active&&mouth!=='closed'?'Teeko 老师正在说话':'Teeko 小麻雀老师'}>
  <svg viewBox="0 0 240 300" aria-hidden="true" focusable="false">
<ellipse className="ground" cx="120" cy="285" rx="58.0" ry="7.0" fill="#1F2A44" opacity=".12"/>
<g className="tk-teeko-rig">
<g className="feet" stroke="#E39A1A" strokeLinecap="round" fill="none">
<path d="M102,258 V273" strokeWidth="7"/>
<path d="M102,273 l-9,6 M102,273 l0,8 M102,273 l9,6" strokeWidth="5.5"/>
<path d="M138,258 V273" strokeWidth="7"/>
<path d="M138,273 l-9,6 M138,273 l0,8 M138,273 l9,6" strokeWidth="5.5"/>
</g>
<g className="tail">
<path d="M168,232 C186,234 206,240 218,252 C204,256 186,254 170,246 Z" fill="#D7631F"/>
<path d="M166,240 C182,248 196,258 202,270 C188,268 174,260 164,250 Z" fill="#EE7A30"/>
</g>
<g className="tuft">
<path d="M114,44 C104,30 104,18 110,10 C118,18 120,32 118,44 Z" fill="#EE7A30"/>
<path d="M120,44 C122,30 128,20 138,16 C138,28 132,38 124,46 Z" fill="#D7631F"/>
</g>
<defs>
<clipPath id={bodyClip}>
<ellipse cx="120" cy="202" rx="72" ry="62"/>
</clipPath>
<clipPath id={headClip}>
<circle cx="120" cy="112" r="76"/>
</clipPath>
</defs>
<g className="tk-teeko-body">
<ellipse cx="120" cy="202" rx="72" ry="62" fill="#EE7A30"/>
<ellipse cx="120" cy="218" rx="52" ry="50" fill="#FFF4DF" clipPath={`url(#${bodyClip})`}/>
</g>
<g className="wing wing-l" transform="translate(66,172) scale(-1,1) rotate(10)">
<path d="M-7,-6 C13,-12 27,8 25,40 C24,58 10,70 -3,63 C-13,55 -15,14 -7,-6 Z" fill="#D7631F"/>
<path d="M4,30 C8,40 8,50 3,57" stroke="#EE7A30" strokeWidth="3" strokeLinecap="round" fill="none" opacity=".7"/>
</g>
<g className="tk-teeko-wing-r" transform="translate(174,172)">
<g className="tk-teeko-handoff-wing" style={{transform:handingOff?'rotate(-64deg)':'rotate(10deg)'}}>
<path d="M-7,-6 C13,-12 27,8 25,40 C24,58 10,70 -3,63 C-13,55 -15,14 -7,-6 Z" fill="#D7631F"/>
<path d="M4,30 C8,40 8,50 3,57" stroke="#EE7A30" strokeWidth="3" strokeLinecap="round" fill="none" opacity=".7"/>{handingOff&&<g className="tk-teeko-microphone" aria-hidden="true">
<rect x="2" y="36" width="13" height="20" rx="6.5" fill="#1F2A44"/>
<path d="M5 42h7M5 47h7" stroke="#C5D4E5" strokeWidth="2" strokeLinecap="round"/>
<path d="M8.5 56v12" stroke="#1F2A44" strokeWidth="5" strokeLinecap="round"/>
</g>}</g>
</g>
<g className="tk-teeko-head">
<circle cx="120" cy="112" r="76" fill="#EE7A30"/>
<ellipse cx="120" cy="142" rx="68" ry="58" fill="#FFF4DF" clipPath={`url(#${headClip})`}/>
<path d="M70,82 C80,62 100,52 118,50" stroke="#F59A5A" strokeWidth="5" strokeLinecap="round" fill="none" opacity=".55"/>
<g className="cheeks" opacity=".9">
<ellipse cx="68" cy="150" rx="12" ry="7.5" fill="#F79E98"/>
<ellipse cx="172" cy="150" rx="12" ry="7.5" fill="#F79E98"/>
</g>
<g className="eyes eyes-open" style={{display:celebrating?'none':'inline'}}>
<ellipse cx="92" cy="121" rx="11" ry="13.5" fill="#1F2A44"/>
<circle cx="95.6" cy="116.2" r="4.2" fill="#FFFFFF"/>
<circle cx="88.6" cy="126" r="1.8" fill="#FFFFFF" opacity=".8"/>
<ellipse cx="148" cy="121" rx="11" ry="13.5" fill="#1F2A44"/>
<circle cx="151.6" cy="116.2" r="4.2" fill="#FFFFFF"/>
<circle cx="144.6" cy="126" r="1.8" fill="#FFFFFF" opacity=".8"/>
</g>
<g className="eyes eyes-blink" style={{display:celebrating?'inline':'none'}}>
<path d="M83,122 Q92,127 101,122" stroke="#1F2A44" strokeWidth="4.5" strokeLinecap="round" fill="none"/>
<path d="M139,122 Q148,127 157,122" stroke="#1F2A44" strokeWidth="4.5" strokeLinecap="round" fill="none"/>
</g>
<g className="tk-teeko-mouth-slot" transform="translate(120,142) scale(1.22) translate(-120,-142)">
<g id={`${rigId}-mouth-closed`} className="on" data-viseme="closed" style={{display:mouth==='closed'?'inline':'none'}}>
<path d="M109,147 Q120,161 131,147 Q120,155 109,147 Z" fill="#E39A1A"/>
<path className="beak-upper" d="M103,137 C110,128.5 130,128.5 137,137 C133.5,145 127,151 120,155.5 C113,151 106.5,145 103,137 Z" fill="#FCC23A"/>
<path d="M110,134.5 C114,132.5 119,132 123,132.6" stroke="#FFE08A" strokeWidth="2.4" strokeLinecap="round" fill="none"/>
</g>
<g id={`${rigId}-mouth-small`} data-viseme="small" style={{display:mouth==='small'?'inline':'none'}}>
<path d="M107,145 Q120,166 133,145 Z" fill="#9E3A17"/>
<path d="M107,145 Q120,170 133,145 Q120,163 107,145 Z" fill="#E39A1A"/>
<path className="beak-upper" d="M103,137 C110,128.5 130,128.5 137,137 C133.5,145 127,151 120,155.5 C113,151 106.5,145 103,137 Z" fill="#FCC23A"/>
<path d="M110,134.5 C114,132.5 119,132 123,132.6" stroke="#FFE08A" strokeWidth="2.4" strokeLinecap="round" fill="none"/>
</g>
<g id={`${rigId}-mouth-wide`} data-viseme="wide" style={{display:mouth==='wide'?'inline':'none'}}>
<path d="M104,143 Q120,183 136,143 Z" fill="#9E3A17"/>
<ellipse cx="120" cy="156" rx="7.5" ry="4.2" fill="#F2806F"/>
<path d="M104,143 Q120,188 136,143 Q120,178 104,143 Z" fill="#E39A1A"/>
<path className="beak-upper" d="M103,137 C110,128.5 130,128.5 137,137 C133.5,145 127,151 120,155.5 C113,151 106.5,145 103,137 Z" fill="#FCC23A"/>
<path d="M110,134.5 C114,132.5 119,132 123,132.6" stroke="#FFE08A" strokeWidth="2.4" strokeLinecap="round" fill="none"/>
</g>
<g id={`${rigId}-mouth-oo`} data-viseme="oo" style={{display:mouth==='oo'?'inline':'none'}}>
<ellipse cx="120" cy="155" rx="7" ry="7.5" fill="#9E3A17"/>
<path d="M111,152 Q111,167.5 120,167.5 Q129,167.5 129,152 Q127.5,163 120,163 Q112.5,163 111,152 Z" fill="#E39A1A"/>
<path className="beak-upper" d="M107,137 C112,129 128,129 133,137 C131,144 126,149 120,152 C114,149 109,144 107,137 Z" fill="#FCC23A"/>
<path d="M112,134.5 C115,133 119,132.6 122,133" stroke="#FFE08A" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
</g>
</g>
</g>
</g>
  </svg>
  {handingOff&&<span className="tk-teacher-handoff-cue" role="status">轮到你啦<span aria-hidden="true">↓</span></span>}
 </div>;
}

export function TeacherStage(props:TeacherAvatarProps){
 return <div className="tk-teacher-stage"><div className="tk-teacher-scene" aria-hidden="true"/><TeacherAvatar {...props}/></div>;
}
