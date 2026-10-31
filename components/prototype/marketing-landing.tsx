'use client';

import { useRef, useState, type MouseEvent } from 'react';
import { ArrowDown, ArrowRight, BookOpen, CameraOff, Check, ChevronDown, FileText, Image as ImageIcon, Lightbulb, MessageCircle, Mic, MousePointer2, Pencil, Undo2 } from 'lucide-react';
import './marketing-landing.css';

const ASSETS = '/prototype-assets/landing';
const NOTES = [
  { icon: MessageCircle, title: '先听他说完', text: '不急着打断，先接住孩子想表达的意思。' },
  { icon: ImageIcon, title: '卡住了，换个问法', text: '给图片、给线索，也可以先跳过。' },
  { icon: Lightbulb, title: '留下一点具体的反馈', text: '记住哪里需要提示，下次再试试。' },
];
const QUESTIONS = [
  { title: '适合什么基础的孩子？', answer: '目前围绕 8–13 岁孩子设计。从熟悉的话题开始，可以先说一个词，再慢慢尝试短句。' },
  { title: '需要开摄像头吗？', answer: '不需要。上课使用麦克风，孩子窗口可以显示头像；随时可以暂停。这里的人物是 AI 生成的演示形象。' },
  { title: '邀请码怎么使用？', answer: '邀请码由我私下分享。首次注册时验证邀请码，再验证邮箱、设置密码。之后用自己的邮箱和密码登录即可。' },
];

function Wordmark({ onClick }: { onClick: () => void }) {
  return <button type="button" className="pl-brand" aria-label="Teeko 落地页首页" onClick={onClick}><span>Tee<span>ko</span></span><img src="/prototype-assets/teeko-head-icon.svg" alt="" /></button>;
}

function ClassroomPreview() {
  const [marked, setMarked] = useState(false);
  return <figure className="pl-preview">
    <div className="pl-classroom">
      <div className="pl-classroom-body">
        <div className="pl-scene">
          <img src={`${ASSETS}/beach.png`} alt="海边教材插图：妈妈和孩子一起搭沙堡，沙滩上有贝壳和皮球" width="1536" height="1024" fetchPriority="high" />
          <div className="pl-lesson-label"><span>LET’S TALK</span><h3>A day at the beach</h3></div>
          <p className="pl-question">Where would you like to go?</p>
          <span className="pl-answer">The beach.</span>
          <button type="button" className={`pl-shell ${marked ? 'is-marked' : ''}`} aria-label="试着圈出教材里的贝壳" aria-pressed={marked} onClick={() => setMarked(value => !value)}><span className="pl-shell-dot" />{marked && <span className="pl-shell-check"><Check size={15} /></span>}</button>
        </div>
        <div className="pl-participants">
          <div className="pl-person pl-teacher"><div className="pl-teacher-room"><span className="pl-room-window" /><img src="/prototype-assets/pose-handoff.svg" alt="Teeko 小麻雀老师" /></div><div className="pl-namebar">Teeko<Mic size={12} /></div></div>
          <div className="pl-person pl-child"><img src={`${ASSETS}/child-demo.png`} alt="AI生成的虚构儿童Alex戴着耳机微笑听讲" width="1448" height="1086" /><div className="pl-namebar">Alex<CameraOff size={12} /></div></div>
        </div>
      </div>
      <div className="pl-preview-tools"><span aria-label="点选工具"><MousePointer2 size={15} /></span><button type="button" aria-label="演示画笔圈出贝壳" aria-pressed={marked} onClick={() => setMarked(true)}><Pencil size={15} /></button><button type="button" aria-label="撤销示意标注" disabled={!marked} onClick={() => setMarked(false)}><Undo2 size={15} /></button><span className="pl-preview-state" role="status">{marked ? 'A shell! What else can you see?' : '试着点一下画笔，或圈出贝壳。'}</span></div>
    </div>
    <figcaption>课堂示意 · 看图、聊天，也能画一画<span>人物为 AI 生成</span></figcaption>
  </figure>;
}

export function MarketingLanding({ invitation, onInvitationChange, onInvitationSubmit, onEnter, onAgreement, loginHref }: {
  invitation: { code: string; error: string; busy?: boolean };
  onInvitationChange: (code: string) => void;
  onInvitationSubmit: () => void;
  onEnter?: (intent: 'register' | 'login') => void;
  onAgreement: () => void;
  loginHref?: string;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState<number | null>(null);
  function jump(event: MouseEvent<HTMLAnchorElement> | null, id: string, focusInput = false) {
    event?.preventDefault();
    const target = scroll.current?.querySelector<HTMLElement>(`#${id}`);
    if (!target) return;
    const container = scroll.current!;
    const offset = container.querySelector('.pl-nav')?.getBoundingClientRect().height ?? 0;
    container.scrollTo({ top: container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - offset - 20, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    (focusInput ? scroll.current?.querySelector<HTMLInputElement>('#pl-invite-code') : target)?.focus({ preventScroll: true });
  }
  return <div className="pl-scroll" ref={scroll}>
    <header className="pl-nav"><div className="pl-nav-inner"><Wordmark onClick={() => scroll.current?.scrollTo({ top: 0, behavior: 'instant' })} /><nav aria-label="了解这个小工具"><a href="#pl-method" onClick={event => jump(event, 'pl-method')}>为什么做</a><a href="#pl-how" onClick={event => jump(event, 'pl-how')}>怎么用</a><a href="#pl-invitation" onClick={event => jump(event, 'pl-invitation', true)}>邀请码</a></nav>{loginHref ? <a className="pl-login" href={loginHref}>登录<ArrowRight size={14} /></a> : <button type="button" className="pl-login" onClick={() => onEnter?.('login')}>登录<ArrowRight size={14} /></button>}</div></header>
    <main className="pl-page">
      <section className="pl-hero" aria-labelledby="pl-hero-title">
        <div className="pl-hero-copy"><p className="pl-kicker">一个爸爸的英语陪学尝试</p><h1 id="pl-hero-title">陪孩子学英语时，<br />我做了一个小工具。</h1><p className="pl-intro">我在摸索怎么让孩子更愿意开口。<br />后来，把这些想法和 AI 结合，做成了 Teeko。<br />也想分享给有需要的家庭，一起慢慢改进。</p><div className="pl-hero-actions"><button type="button" className="pl-button" onClick={() => jump(null, 'pl-invitation', true)}>填写邀请码<ArrowRight size={18} /></button><a className="pl-text-link" href="#pl-how" onClick={event => jump(event, 'pl-how')}>先看看怎么用<ArrowDown size={15} /></a></div></div>
        <ClassroomPreview />
      </section>
      <section className="pl-section pl-method" aria-labelledby="pl-method">
        <p className="pl-section-number">01 / 一点想法</p><h2 id="pl-method" tabIndex={-1}>先让孩子愿意聊，再慢慢练表达。</h2>
        <div className="pl-method-grid"><figure className="pl-notebook"><img src={`${ASSETS}/notebook.png`} alt="阳光下的陪学笔记本、铅笔和绿植插画" loading="lazy" width="1536" height="1024" /><div className="pl-notebook-writing" aria-hidden="true"><span>愿意开口</span><span>多一些兴趣</span><span>慢慢练表达</span></div><img className="pl-notebook-bird" src="/prototype-assets/pose-idle-listening.svg" alt="" loading="lazy" /><figcaption>慢一点，也没关系。</figcaption></figure><div className="pl-notes">{NOTES.map(({ icon: Icon, title, text }) => <article key={title}><span className="pl-note-icon"><Icon size={24} strokeWidth={1.6} /></span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></div>
      </section>
      <section className="pl-section pl-how" aria-labelledby="pl-how"><p className="pl-section-number">02 / 怎么用</p><h2 id="pl-how" tabIndex={-1}>挑个话题，和 Teeko 聊一会儿。</h2>
        <ol className="pl-steps"><li><h3><span>1</span>选一个话题</h3><div className="pl-step-paper pl-course-example"><p>从孩子熟悉的事情开始</p><img src={`${ASSETS}/beach.png`} alt="海边的一天课程示意" loading="lazy" width="1536" height="1024" /><div><strong>海边的一天</strong><span>聊聊想去的地方</span></div><span className="pl-example-label">课程示例</span></div></li><li><h3><span>2</span>看图、开口、画一画</h3><div className="pl-step-paper pl-interaction-example"><div><img src={`${ASSETS}/beach.png`} alt="画笔圈出教材中的贝壳示意" loading="lazy" width="1536" height="1024" /><span className="pl-example-circle" /><img className="pl-interaction-bird" src="/prototype-assets/pose-handoff.svg" alt="" loading="lazy" /></div><blockquote>“A shell! What can you see?”</blockquote><p>卡住了，换个问法接着聊。</p></div></li><li><h3><span>3</span>看看这次的小结</h3><div className="pl-step-paper pl-report-example"><div><FileText size={20} /><strong>这次的小进步</strong><span>示例</span></div><blockquote>I’m going to the beach.</blockquote><p><strong>课堂表现</strong>在提示后，说出了一句周末计划。</p><p><strong>下次试试</strong>换一个想去的地方，再表达一次。</p><small>详细报告整理后可查看</small></div></li></ol>
        <p className="pl-camera-note"><CameraOff size={17} />摄像头可以不开，卡住了也能暂停。</p>
      </section>
      <section className="pl-invitation" aria-labelledby="pl-invitation"><img src="/prototype-assets/pose-idle-listening.svg" alt="" className="pl-invitation-bird" loading="lazy" /><div><p className="pl-section-number">03 / 一起试试</p><h2 id="pl-invitation" tabIndex={-1}>如果你也想给孩子试试。</h2><p>目前通过邀请码开放。<br />邀请码由我私下分享，欢迎带着真实的使用感受回来聊聊。</p></div><form className="pl-invite-form" aria-busy={invitation.busy || undefined} noValidate onSubmit={event => { event.preventDefault(); onInvitationSubmit(); }}><label htmlFor="pl-invite-code">邀请码<input id="pl-invite-code" name="invitation" disabled={invitation.busy} value={invitation.code} onChange={event => onInvitationChange(event.target.value)} maxLength={100} placeholder="输入你收到的邀请码" autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-invalid={!!invitation.error} aria-describedby={invitation.error ? 'pl-invite-error' : undefined} /></label>{invitation.error && <p id="pl-invite-error" className="pl-invite-error" role="alert">{invitation.error}</p>}<button type="submit" className="pl-button" disabled={invitation.busy}>{invitation.busy ? <span role="status">正在验证…</span> : '验证并继续'}<ArrowRight size={18} /></button>{loginHref ? <a className="pl-existing" href={loginHref}>已有账号？<span>登录</span></a> : <button type="button" className="pl-existing" onClick={() => onEnter?.('login')}>已有账号？<span>登录</span></button>}</form></section>
      <section className="pl-faq" aria-labelledby="pl-faq-heading"><h2 id="pl-faq-heading">你可能还想问</h2><div>{QUESTIONS.map((item, index) => <div className="pl-faq-item" key={item.title}><button type="button" aria-expanded={question === index} aria-controls={`pl-faq-${index}`} onClick={() => setQuestion(question === index ? null : index)}><span>{item.title}</span><ChevronDown size={16} /></button><p id={`pl-faq-${index}`} hidden={question !== index}>{item.answer}</p></div>)}</div><BookOpen className="pl-faq-decoration" size={90} strokeWidth={.7} aria-hidden="true" /></section>
    </main>
    <footer className="pl-footer"><Wordmark onClick={() => scroll.current?.scrollTo({ top: 0, behavior: 'instant' })} /><p>边陪孩子学，边把工具做好。</p><button type="button" onClick={onAgreement}>用户协议</button></footer>
  </div>;
}
