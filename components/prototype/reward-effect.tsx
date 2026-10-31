'use client';
import type { CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';

export function Fireworks() {
  return <div className="tp-fireworks" aria-hidden="true">{[[28, 35], [68, 24], [57, 62]].map(([left, top], burst) => <div className="tp-firework" key={burst} style={{ left: `${left}%`, top: `${top}%`, '--burst-delay': `${burst * .16}s` } as CSSProperties}><span className="tp-firework-ring" />{Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 6, distance = 65 + i % 3 * 18;
    return <i key={i} style={{ '--spark-x': `${Math.cos(angle) * distance}px`, '--spark-y': `${Math.sin(angle) * distance}px`, '--spark-color': ['#df7b3d', '#2a9d8f', '#e6b64a'][i % 3], '--spark-angle': `${i * 30}deg` } as CSSProperties} />;
  })}</div>)}</div>;
}

export function RewardSticker({ kind }: { kind: 'answer' | 'speech' }) {
  return <div className="tp-reward-sticker" role="status"><Sparkles size={25} /><div><strong>{kind === 'speech' ? '说得真棒！' : '找对啦！'}</strong><span>{kind === 'speech' ? '勇敢开口 · Teeko 为你鼓掌' : '小小探索家 · 继续保持好奇'}</span></div></div>;
}
