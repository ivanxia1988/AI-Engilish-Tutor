"use client";
import { useEffect, useRef, type RefObject } from 'react';

/** Original SVG character. The live mouth follows received audio energy, not generated captions. */
export function TeacherAvatar({ level, speaking = false, connected, paused }: { level: RefObject<number>; speaking?: boolean; connected: boolean; paused: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0, smooth = 0;
    const animate = (now: number) => {
      const energy = paused ? 0 : connected ? level.current : speaking ? .3 + Math.abs(Math.sin(now / 92)) * .45 : 0;
      smooth += (energy - smooth) * .45;
      root.current?.style.setProperty('--voice-level', String(smooth));
      root.current?.classList.toggle('is-talking', smooth > .07);
      frame = requestAnimationFrame(animate);
    };
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(animate);
    return () => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame); };
  }, [level, connected, paused, speaking]);
  return <div ref={root} className={`teacher-avatar ${paused ? 'is-paused' : ''}`} role="img" aria-label="小叶老师的互动头像，播放语音时嘴巴开合、头部轻轻活动">
    <div className="avatar-orbit orbit-one" /><div className="avatar-orbit orbit-two" /><span className="avatar-spark spark-one">✦</span><span className="avatar-spark spark-two">✧</span>
    <svg viewBox="0 0 300 300" aria-hidden="true">
      <defs><linearGradient id="leaf-shirt" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7c9c87" /><stop offset="1" stopColor="#456e63" /></linearGradient></defs>
      <ellipse cx="150" cy="281" rx="83" ry="10" fill="#315a4820" />
      <path d="M66 286c2-54 25-82 84-82s82 28 84 82" fill="url(#leaf-shirt)" />
      <path d="M121 209l29 27 29-27" fill="#fff9e9" /><path d="M139 238l11 18 11-18" fill="#e9b671" />
      <g className="avatar-head">
        <path d="M87 148C64 93 82 43 131 38c66-16 107 29 84 111l-8 55H91Z" fill="#3e3936" />
        <ellipse cx="90" cy="145" rx="14" ry="19" fill="#edb99b" /><ellipse cx="211" cy="145" rx="14" ry="19" fill="#edb99b" />
        <path d="M91 116c0-41 117-42 118 0v39c0 44-29 66-59 66s-59-22-59-66Z" fill="#f8ceb0" />
        <path d="M84 117C79 70 110 51 143 51c36-7 69 18 74 66-29-6-48-21-63-40-17 22-41 33-70 40Z" fill="#49413b" />
        <path d="M183 61c10-23 21-26 30-21-1 13-10 25-30 21Z" fill="#8faa77" /><path d="M184 62c-10-12-10-22-3-28 10 3 15 13 3 28Z" fill="#b5c48d" />
        <path d="M110 128q10-7 19-1M173 127q9-6 18 1" fill="none" stroke="#645047" strokeWidth="3" strokeLinecap="round" />
        <g className="avatar-eyes"><ellipse cx="121" cy="144" rx="5" ry="6" fill="#403d3b" /><ellipse cx="181" cy="144" rx="5" ry="6" fill="#403d3b" /><circle cx="122" cy="142" r="1.5" fill="white" /><circle cx="182" cy="142" r="1.5" fill="white" /></g>
        <ellipse cx="108" cy="165" rx="12" ry="6" fill="#e99e8d" opacity=".5" /><ellipse cx="194" cy="165" rx="12" ry="6" fill="#e99e8d" opacity=".5" />
        <path d="M151 149l-3 13h7" fill="none" stroke="#d3987a" strokeWidth="2.5" strokeLinecap="round" />
        <g className="avatar-mouth"><ellipse cx="151" cy="181" rx="13" ry="10" fill="#733d3a" /><ellipse cx="151" cy="186" rx="8" ry="4" fill="#df8583" /><path d="M141 173h20v4h-20Z" fill="#fff9ee" /></g>
        <path className="avatar-smile" d="M139 179q12 12 24 0" fill="none" stroke="#9b5f52" strokeWidth="3" strokeLinecap="round" />
        <circle cx="91" cy="163" r="4" fill="#d7b765" /><circle cx="210" cy="163" r="4" fill="#d7b765" />
      </g>
      <path d="M202 251c-11-13-23-9-25 4 12 7 23 6 25-4Z" fill="#c6d6ad" />
    </svg>
    <div className="avatar-presence"><i />{paused ? '陪你休息一下' : connected ? '小叶老师 · 和你在一起' : '小叶老师 · 准备好啦'}</div>
  </div>;
}
