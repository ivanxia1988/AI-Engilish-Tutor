'use client';

import React, { useEffect, useReducer, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, CameraOff, Check, ChevronLeft, ChevronRight, Clock, FileText, Headphones, HelpCircle, LayoutGrid, Landmark, LibraryBig, Lock, LogOut, MessageCircle, Mic, MicOff, Monitor, MoreHorizontal, Pause, PhoneOff, Play, RotateCcw, Settings, ShieldCheck, Tablet, Telescope, Film, Trash2, User, Volume2, VolumeX, Wifi, X } from 'lucide-react';
import { PROTOTYPE_SCREENS, prototypeDestination, resumeLesson, cancelLessonEnd, restoreLessonConnection, resolvePrototypeScreen, type PrototypeGroup, type PrototypeMode, type PrototypeScreenId } from '../../lib/prototype-flow';
import { createPrototypeAuth, leavePrototypeAuth, markPrototypeProfileComplete, navigatePrototypeAuth } from '../../lib/prototype-auth';
import { PrototypeAuthForm } from './auth-form';
import { MarketingLanding } from './marketing-landing';
import { usePrototypeAnnotations } from './annotation-layer';
import { createTeachingSettings, teachingSettingsReducer } from '../../lib/prototype-teaching';
import { INTERACTION_TASKS, createInteraction, interactionReducer, selectionForMark } from '../../lib/prototype-interactions';
import type { PrototypeMark } from '../../lib/prototype-annotations';
import { Fireworks, RewardSticker } from './reward-effect';
import { PrototypeSounds, type PrototypeSound } from '../../lib/prototype-sounds';
import { TeachingSettings } from './teaching-settings';
import { END_REASONS, INTERACTION_PAUSES, CONNECTION_LABELS, endPresentation, participantConnection, shouldProtectLessonExit, bindLessonExitProtection, type EndReason, type InteractionPause, type ConnectionQuality } from '../../lib/prototype-session';
import './prototype.css';

type Variant = 'normal' | 'listening' | 'limit' | 'pending' | 'failed' | 'brief';
type DialogState = { title: string; body: string; confirm?: string; action?: () => void };
const GROUPS: PrototypeGroup[] = ['开始学习', '课堂互动', '学习记录', '我的与设置'];
const AGE_RANGES = ['8–9', '10–11', '12–13'] as const;
const PROFILE_LEVELS = [
  { id: 'starter', title: '刚开始学', example: '只认得 Hello、apple 这类词' },
  { id: 'sentences', title: '能说简单句', example: '能说 “I like apples.”，表达喜好' },
  { id: 'conversation', title: '能简单聊天', example: '能用英语聊兴趣、学校或周末' },
  { id: 'unsure', title: '不确定', example: '第一课再了解一下' },
] as const;
const COURSE_TITLES = ['初次见面', '缤纷色彩', '周末计划', '美味食物', '我的家人', '我的一天'];
const COURSE_INTROS = [
  { title: 'Nice to meet you', description: '和 Teeko 打个招呼，用英语介绍自己的名字和喜欢的东西。', topics: ['打招呼', '介绍自己', '问对方的名字'], words: 'hello · name · friend', expression: 'My name is…' },
  { title: 'A world of colors', description: '找找身边的颜色，和 Teeko 聊聊你最喜欢哪一种。', topics: ['认识颜色', '描述物品', '表达喜好'], words: 'red · blue · green', expression: 'My favorite color is…' },
  { title: 'Weekend plans', description: '和 Teeko 聊聊周末想去哪里，试着用英语说出自己的计划。', topics: ['想去的地方', '周末安排', '邀请朋友'], words: 'museum · cinema · weekend', expression: 'I’m going to…' },
  { title: 'Food I like', description: '从你爱吃的食物聊起，告诉 Teeko 你喜欢什么、想尝尝什么。', topics: ['食物名称', '喜欢的口味', '点一份食物'], words: 'apple · bread · milk', expression: 'I’d like…' },
  { title: 'Meet my family', description: '向 Teeko 介绍家里的人，聊聊你们平时喜欢一起做什么。', topics: ['家庭成员', '介绍家人', '一起做的事'], words: 'mother · father · family', expression: 'This is my…' },
  { title: 'A day in my life', description: '和 Teeko 说说你的一天，从起床、上学到放学后的活动。', topics: ['日常活动', '时间安排', '放学以后'], words: 'morning · school · play', expression: 'I usually…' },
];
const WORD_ICONS = [Landmark, Telescope, Film, LibraryBig];
const WORDS = [['museum', '博物馆'], ['telescope', '望远镜'], ['cinema', '电影院'], ['bookstore', '书店'], ['weekend', '周末'], ['visit', '参观']];
const REPORTS = [{ date: '今天 · 16:30', title: 'Weekend plans', state: '查看报告', variant: 'normal' }, { date: '昨天 · 18:15', title: 'My favorite color', state: '简版', variant: 'brief' }, { date: '周三 · 17:40', title: 'At the museum', state: '生成中', variant: 'pending' }, { date: '周二 · 18:00', title: 'Hello, Teeko', state: '生成失败 · 重试', variant: 'failed' }, { date: '上周日 · 10:20', title: 'My family', state: '查看报告', variant: 'normal' }, { date: '上周六 · 10:00', title: 'Food I like', state: '查看报告', variant: 'normal' }] as const;


const DEMO_RECOMMENDATIONS = [
  { focus: 'telescope 的重音', kind: '发音纠正', observation: '读 telescope 时，重音落在后半段。', correction: '示范 TEL·e·scope，强调第一个音节。', result: '跟读时已调整，独立说时还需确认。', practice: '下次先听这个词，再放进句子试一次；卡住时再听示范。', example: 'I’m going to see a big telescope.' },
  { focus: '把计划说成完整句', kind: '表达卡点', observation: '被问到周末计划时，先只说了“museum”。', correction: '给出“I’m going to…”作为句首提示。', result: '提示后说出了完整计划，尚未独立表达。', practice: '换成 cinema，试着自己说一条计划；需要时才给句首提示。', example: 'I’m going to the cinema.' },
];

function Button({ children, kind = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'accent' | 'ghost' }) {
  return <button {...props} className={`tp-button tp-${kind} ${className}`} type={props.type ?? 'button'}>{children}</button>;
}
function Bird({ pose = 'idle-listening', className = '' }: { pose?: string; className?: string }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => { const preference = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReducedMotion(preference.matches); update(); preference.addEventListener('change', update); return () => preference.removeEventListener('change', update); }, []);
  if (pose === 'loop' && reducedMotion) pose = 'talking';
  return <img className={`tp-bird ${className}`} src={`/prototype-assets/${pose === 'loop' ? 'teeko-talking-loop' : `pose-${pose}`}.svg`} alt="Teeko 小麻雀" />;
}
function Brand({ onClick }: { onClick?: () => void }) {
  return <button className="tp-brand" onClick={onClick} aria-label="Teeko 首页"><span>Tee<span>ko</span></span><img src="/prototype-assets/teeko-head-icon.svg" alt="" /></button>;
}
function Metric({ value, label }: { value: string; label: string }) { return <div className="tp-metric"><strong>{value}</strong><span>{label}</span></div>; }
function Chip({ children, soft = false }: { children: ReactNode; soft?: boolean }) { return <span className={`tp-chip ${soft ? 'is-soft' : ''}`}>{children}</span>; }
function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) { return <button className={`tp-switch ${checked ? 'is-on' : ''}`} role="switch" aria-label={label} aria-checked={checked} onClick={onChange}><span /></button>; }
function Tabs({ values, tab, onChange }: { values: string[]; tab: number; onChange: (value: number) => void }) { return <div className="tp-tabs" role="tablist">{values.map((value, i) => <button key={value} role="tab" aria-selected={tab === i} className={tab === i ? 'is-active' : ''} onClick={() => onChange(i)}>{value}</button>)}</div>; }
function Row({ icon, title, description, onClick, children }: { icon?: ReactNode; title: string; description?: string; onClick?: () => void; children?: ReactNode }) { return <div className="tp-setting-row"><span className="tp-row-icon">{icon}</span><div className="tp-row-copy"><strong>{title}</strong>{description && <p>{description}</p>}</div>{children}{onClick && <button className="tp-icon-button" onClick={onClick} aria-label={title}><ChevronRight size={20} /></button>}</div>; }

function ConnectionBadge({ owner, quality, open, onToggle }: { owner: string; quality: ConnectionQuality; open: boolean; onToggle: () => void }) {
  return <div className={`tp-participant-connection tp-connection-${quality}`}><button aria-label={`查看${owner}连接状态`} aria-expanded={open} onClick={onToggle}><Wifi size={12} /><span>{CONNECTION_LABELS[quality]}</span></button>{open && <section className="tp-connection-details" aria-label={`${owner}连接详情`}><strong>{owner}连接</strong><span>{CONNECTION_LABELS[quality]}</span><p>{quality === 'good' ? '声音传输顺畅。' : quality === 'weak' ? '声音可能断续，检查网络后再继续。' : quality === 'disconnected' ? '连接已中断，正在等待恢复。' : '暂未获得连接质量数据。'}</p></section>}</div>;
}

function Scene({ onSelect, classForAnswer = () => '' }: { onSelect?: (id: string) => void; classForAnswer?: (id: string) => string }) {
  const keyboard = (event: React.KeyboardEvent<SVGGElement>, id: string) => { if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(id); } };
  return <svg viewBox="0 0 360 190" className="tp-scene" role={onSelect ? 'group' : 'img'} aria-label="课件插图：科学博物馆和望远镜">
    <rect width="360" height="190" rx="12" fill="#eef2f7" /><circle cx="286" cy="42" r="23" fill="#ead8a0" /><path d="M0 150 Q90 120 180 145 T360 132 V190 H0" fill="#dcece8" />
    <g data-answer="museum" className={`tp-answer-target tp-scene-answer ${classForAnswer('museum')}`} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label="选择博物馆图片" onClick={() => onSelect?.('museum')} onKeyDown={event => keyboard(event, 'museum')}>
      <rect className="tp-scene-outline" x="42" y="29" width="177" height="141" rx="10" /><path d="M55 81 L130 38 L205 81Z" fill="#a3aabd" /><rect x="65" y="81" width="130" height="75" fill="#d5dce8" /><path d="M85 90V153M115 90V153M145 90V153M175 90V153" stroke="#fff" strokeWidth="12" /><rect x="51" y="153" width="157" height="10" rx="3" fill="#a3aabd" />
    </g>
    <g data-answer="telescope" className={`tp-answer-target tp-scene-answer ${classForAnswer('telescope')}`} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label="选择望远镜图片" onClick={() => onSelect?.('telescope')} onKeyDown={event => keyboard(event, 'telescope')}>
      <rect className="tp-scene-outline" x="221" y="65" width="85" height="107" rx="10" /><path d="M265 100L245 166M265 100L290 166" stroke="#5c6886" strokeWidth="6" strokeLinecap="round" /><path d="M235 106L291 75" stroke="#3a4766" strokeWidth="18" /><circle cx="236" cy="106" r="10" fill="#8ccfc6" />
    </g>
    <path d="M32 157V121M329 155V126" stroke="#5c6886" strokeWidth="6" /><circle cx="32" cy="114" r="11" fill="#e8bd9b" /><circle cx="329" cy="119" r="11" fill="#e8bd9b" /><path d="M24 133H40M321 139H337" stroke="#2a9d8f" strokeWidth="17" />
  </svg>;
}

export default function Prototype() {
  const [screen, setScreen] = useState<PrototypeScreenId>('01');
  const [view, setView] = useState<'overview' | 'player'>('overview');
  const [mode, setMode] = useState<PrototypeMode>('full');
  const [device, setDevice] = useState<'desktop' | 'tablet'>('desktop');
  const [directory, setDirectory] = useState(false);
  const [group, setGroup] = useState<PrototypeGroup>('开始学习');
  const [history, setHistory] = useState<PrototypeScreenId[]>([]);
  const [variant, setVariant] = useState<Variant>('normal');
  const [tab, setTab] = useState(0);
  const [firstLesson, setFirstLesson] = useState(true);
  const [name, setName] = useState('Leo');
  const [level, setLevel] = useState<(typeof PROFILE_LEVELS)[number]['id']>('unsure');
  const [age, setAge] = useState<(typeof AGE_RANGES)[number]>('10–11');
  const [auth, setAuth] = useState(createPrototypeAuth);
  const [error, setError] = useState('');
  const [courseIndex, setCourseIndex] = useState(2);
  const [interaction, interact] = useReducer(interactionReducer, undefined, createInteraction);
  const [celebrating, setCelebrating] = useState(false);
  const lastAward = useRef(0);
  const sounds = useRef(new PrototypeSounds());
  const previewEpoch = useRef(0);
  const canInteract = view === 'player' && ['06', '07', '09'].includes(screen);
  const task = INTERACTION_TASKS[interaction.taskIndex];
  const [endReason, setEndReason] = useState<EndReason>('manual');
  const [interactionPause, setInteractionPause] = useState<InteractionPause>('silence');
  const [teacherConnection, setTeacherConnection] = useState<ConnectionQuality>('good');
  const [studentConnection, setStudentConnection] = useState<ConnectionQuality>('good');
  const [connectionDetails, setConnectionDetails] = useState<'teacher' | 'student' | null>(null);
  const [annotationSession, setAnnotationSession] = useState(0);
  const [teaching, updateTeaching] = useReducer(teachingSettingsReducer, undefined, createTeachingSettings);
  const [recording, setRecording] = useState(false);
  const [word, setWord] = useState('');
  const [reportPage, setReportPage] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toast, setToast] = useState('');
  const [compact, setCompact] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const lessonOrigin = useRef<PrototypeScreenId>('06');
  const endOrigin = useRef<PrototypeScreenId>('06');
  const reconnectOrigin = useRef<PrototypeScreenId>('06');
  const info = PROTOTYPE_SCREENS.find(item => item.id === screen)!;
  const screenIndex = PROTOTYPE_SCREENS.findIndex(item => item.id === screen);
  const annotations = usePrototypeAnnotations(!['06', '07', '08', '09', '10'].includes(screen), annotationSession, answerFromMark);
  const protectExit = view === 'player' && shouldProtectLessonExit(screen, endReason) && !(screen === '21' && variant === 'limit');
  useEffect(() => protectExit ? bindLessonExitProtection(window) : undefined, [protectExit]);
  useEffect(() => {
    setCelebrating(false);
    if (!canInteract || !interaction.awardId || interaction.awardId === lastAward.current) return;
    lastAward.current = interaction.awardId; setCelebrating(true);
    if (teaching.saved.effects) void sounds.current.play(interaction.awardKind === 'speech' ? 'celebrate' : 'correct');
    const timer = window.setTimeout(() => setCelebrating(false), 2600);
    return () => window.clearTimeout(timer);
  }, [interaction.awardId, canInteract, teaching.saved.effects]);
  useEffect(() => { interact({ type: 'reset' }); setCelebrating(false); }, [annotationSession]);
  useEffect(() => { if (screen === '09') interact({ type: 'hint' }); }, [screen]);
  useEffect(() => { if (!teaching.saved.effects) sounds.current.stop(); }, [teaching.saved.effects]);
  useEffect(() => () => { previewEpoch.current++; sounds.current.dispose(); }, []);


  useEffect(() => {
    const read = () => { const id = resolvePrototypeScreen(window.location.hash.slice(1)); const found = PROTOTYPE_SCREENS.find(item => item.id === id); if (found) { setAuth(leavePrototypeAuth); if (found.id === '27') updateTeaching({ type: 'open' }); setScreen(found.id); setGroup(found.group); setVariant(found.id === '12' ? 'pending' : 'normal'); setView('player'); if (window.location.hash !== `#${found.id}`) window.history.replaceState(null, '', `#${found.id}`); } };
    read(); window.addEventListener('hashchange', read); return () => window.removeEventListener('hashchange', read);
  }, []);
  useEffect(() => { if (!frame.current) return; const observer = new ResizeObserver(entries => { const box = entries[0].contentRect; setCompact(box.height < 740 || box.width < 1060); }); observer.observe(frame.current); return () => observer.disconnect(); }, [view]);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(''), 3200); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    const modal = frame.current?.querySelector<HTMLElement>('[role="dialog"]');
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]'));
    controls()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (dialog) setDialog(null); else if (screen === '19') { if (endReason === 'manual') cancelEnd(); else go('12'); } else if (screen !== '11') go(resumeLesson(lessonOrigin.current)); }
      if (event.key !== 'Tab') return;
      const items = controls(); const first = items[0]; const last = items.at(-1);
      if (!modal.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, [dialog, screen, endReason]);

  function go(id: PrototypeScreenId) {
    id = resolvePrototypeScreen(id) ?? '01';
    if (screen === '01' && id !== '01') setAuth(leavePrototypeAuth);
    setCelebrating(false); previewEpoch.current++; sounds.current.stop();
    if (id === '06' && ['05', '17'].includes(screen)) interact({ type: 'reset' });
    if (id === '27') updateTeaching({ type: 'open' });
    if (id === '19') endOrigin.current = screen;
    if (id === '20' && screen !== '19' && screen !== '20') reconnectOrigin.current = screen;
    if (['11', '18', '19', '20'].includes(id) && ['06', '07', '08', '09', '10'].includes(screen)) lessonOrigin.current = screen;
    setHistory(items => [...items.slice(-30), screen]); setScreen(id); setGroup(PROTOTYPE_SCREENS.find(item => item.id === id)!.group); setView('player'); setVariant(id === '12' ? 'pending' : 'normal'); setTab(0); setError(''); setWord(''); setDialog(null); setToast(''); setConnectionDetails(null);
    window.history.replaceState(null, '', `#${id}`);
  }
  function answerFromMark(mark: PrototypeMark, bounds: DOMRect) {
    if (!canInteract || bounds.width < 1 || bounds.height < 1) return;
    const objects = Array.from(frame.current?.querySelectorAll<HTMLElement | SVGElement>('.tp-answer-target') ?? []).map(element => {
      const rect = element.getBoundingClientRect(), id = element.dataset.answer!;
      return { id, label: id, chinese: '', box: { x: (rect.left - bounds.left) / bounds.width, y: (rect.top - bounds.top) / bounds.height, w: rect.width / bounds.width, h: rect.height / bounds.height } };
    });
    const ids = selectionForMark(mark, objects);
    if (ids !== null) submitAnswer(ids);
  }
  function playSound(kind: PrototypeSound) { if (teaching.saved.effects) void sounds.current.play(kind); }
  function submitAnswer(ids: string[]) {
    if (!canInteract || interaction.status === 'correct') return;
    const unique = [...new Set(ids)];
    if (unique.length !== 1) playSound('hint'); else if (unique[0] !== task.target) playSound('retry');
    interact({ type: 'answer', ids });
  }
  function answer(id: string) { submitAnswer([id]); }
  function nextQuestion() { annotations.cancelDraft(); sounds.current.stop(); setCelebrating(false); interact({ type: 'next' }); }
  function answerClass(id: string) {
    if (interaction.selected === id && interaction.status === 'correct') return 'is-correct';
    if (interaction.selected === id && interaction.status === 'retry') return 'is-retry';
    return interaction.highlighted && task.target === id ? 'is-hinted' : '';
  }
  function interactionScenario(value: string) {
    if (value === 'praise') { if (canInteract && !celebrating) interact({ type: 'praise' }); return; }
    if (value === 'choose' || value === 'circle') { interact({ type: 'reset' }); annotations.chooseTool(value === 'circle' ? 'pen' : 'pointer'); go('07'); return; }
    if (value === 'interaction') go('11'); else requestEnd(value as EndReason);
  }
  function home() { go(prototypeDestination('lesson-finished', mode)); }
  function pause() { if (['06', '07', '08', '09', '10'].includes(screen)) lessonOrigin.current = screen; go('18'); }
  function resume() { go(resumeLesson(lessonOrigin.current)); }
  function cancelEnd() { go(cancelLessonEnd(endOrigin.current, lessonOrigin.current)); }
  function requestEnd(reason: EndReason = 'manual') { setEndReason(reason); go('19'); }
  function startCourse() { setAnnotationSession(value => value + 1); go(prototypeDestination('lesson-selected', mode, firstLesson)); }
  function changeConnection(side: 'teacher' | 'student', quality: ConnectionQuality) { if (side === 'teacher') setTeacherConnection(quality); else setStudentConnection(quality); if (quality === 'disconnected') go('20'); }
  function restoreConnection() { setTeacherConnection(value => value === 'disconnected' ? 'good' : value); setStudentConnection(value => value === 'disconnected' ? 'good' : value); go(restoreLessonConnection(reconnectOrigin.current, lessonOrigin.current)); }
  function report(state: Variant = 'normal') { go('13'); setVariant(state); }
  function demo(message: string) { setToast(message); }
  function journey(type: 'new' | 'daily' | 'error' | 'parent') { setDirectory(false); setFirstLesson(type === 'new'); go(type === 'new' ? '00' : type === 'daily' ? '03' : type === 'error' ? '15' : '25'); }
  function AppHeader({ title, backTo, actions = true, reports = true }: { title?: string; backTo?: PrototypeScreenId; actions?: boolean; reports?: boolean }) {
    return <header className="tp-app-header"><div className="tp-header-leading">{backTo && <button className="tp-icon-button" onClick={() => go(backTo)} aria-label="返回"><ArrowLeft size={20} /></button>}<Brand onClick={home} />{title && <><span className="tp-header-divider" /><span className="tp-header-title">{title}</span></>}</div>{actions && <div className="tp-header-actions">{reports && <button className="tp-text-button" onClick={() => go('23')}><FileText size={17} />学习报告</button>}<button className="tp-avatar" onClick={() => go('25')} aria-label="我的">{name.slice(0, 1).toUpperCase() || 'L'}</button></div>}</header>;
  }
  function Heading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) { return <div className="tp-page-heading">{eyebrow && <span className="tp-eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>; }


  function lesson() {
    const paused = screen === '18' || screen === '19' || screen === '11';
    const reconnecting = screen === '20';
    const listening = variant === 'listening';
    const speaking = screen === '06' || screen === '10';
    const waiting = screen === '07' || screen === '09';
    const pose = celebrating ? 'celebrate' : screen === '08' ? 'thinking' : waiting && !listening ? 'handoff' : speaking ? 'loop' : 'idle-listening';
    const teacherState = celebrating ? '为你鼓掌' : reconnecting ? '正在重连' : paused ? '已暂停' : speaking ? '正在讲话' : screen === '08' ? '正在思考' : '在听你说';
    const childState = screen === '11' ? '已暂停' : listening ? '正在讲话' : waiting ? '轮到你了' : null;
    const end = endPresentation(endReason);
    const pauseInfo = INTERACTION_PAUSES.find(item => item.id === interactionPause)!;
    return <div className={`tp-lesson tp-call-lesson ${paused ? 'is-paused' : ''} ${reconnecting ? 'is-reconnecting' : ''}`}>
      <span className="tp-sr-only" role="status">{paused ? '课堂已暂停' : reconnecting ? '连接中断，等待恢复' : screen === '08' ? 'Teeko 正在思考' : listening ? '正在听你说话' : waiting ? '轮到你说话' : 'Teeko 正在讲解'}。页面流演示，未连接语音。</span>
      <div className="tp-lesson-progress"><span style={{ width: `${screen === '10' ? 58 : 37}%` }} /></div>
      <header className="tp-call-header"><div className="tp-call-course"><BookOpen size={17} /><strong>周末计划</strong><span>Weekend plans</span></div></header>
      <div className="tp-call-body">
      <div className="tp-book-space"><article className="tp-lesson-paper"><div className="tp-paper-meta"><strong>COURSE 03 · WEEKEND PLANS</strong><span>Part A · Let’s talk</span></div><h2>What are you going to do?</h2><div className="tp-book-reading"><div><Scene onSelect={canInteract ? answer : undefined} classForAnswer={answerClass} /><p>Mike and Amy are talking about<br />their weekend plans.</p></div><div className="tp-dialogue"><p><b>Mike</b> What are you going to do this weekend?</p><p className={speaking ? 'tp-reading-line' : ''}><b>Amy</b> I’m going to visit the <span className="tp-current-word">science museum</span>.</p><p><b>Mike</b> Cool! What are you going to see there?</p><p className={waiting || screen === '10' ? 'tp-target-line' : ''}><b>Amy</b> I’m going to see a big <span className={`${screen === '09' ? 'tp-hint-word' : ''} ${screen === '10' ? 'tp-pron-word' : ''}`} onClick={() => demo('原型演示：这里会播放 telescope 的标准读音。')}>telescope{screen === '10' && <small>TEL·e·scope · 重音在前</small>}</span>.</p><p><b>Mike</b> Sounds great! Have a good time.</p></div></div><div className={`tp-task-line tp-task-${interaction.status}`}><div role="status"><strong>{interaction.status === 'correct' ? (interaction.assisted ? '提示后找对了！' : '找对了！') : interaction.status === 'retry' ? '再试一次' : interaction.status === 'unclear' ? '试着只圈一个' : task.prompt}</strong><span>{interaction.status === 'correct' ? task.reply : interaction.status === 'retry' || interaction.status === 'hint' ? task.hint : interaction.status === 'unclear' ? '还没选清楚，可以重新圈，或直接点选。' : '点击图片、词卡，也可以圈出答案。'}</span></div><button disabled={!canInteract || interaction.status === 'correct'} onClick={() => { interact({ type: 'hint' }); playSound('hint'); }}>提示一下</button><button disabled={!canInteract} onClick={nextQuestion}>{interaction.status === 'correct' ? '再来一题' : '换一题'}<ArrowRight size={13} /></button></div>
      <div className="tp-book-words">{WORDS.slice(0, 4).map(([en, zh], i) => { const Icon = WORD_ICONS[i]; return <button key={en} data-answer={en} disabled={!canInteract} onClick={() => answer(en)} aria-pressed={interaction.selected === en} className={`tp-answer-target ${answerClass(en)}`}><div className={`tp-word-art tp-word-art-${i}`}><Icon size={26} strokeWidth={1.6} /></div><strong>{en}</strong><span>{zh}</span>{interaction.selected === en && (interaction.status === 'correct' || interaction.status === 'retry') && <i className="tp-answer-verdict" aria-hidden="true">{interaction.status === 'correct' ? <Check size={14} /> : <RotateCcw size={14} />}</i>}{interaction.highlighted && task.target === en && interaction.status !== 'correct' && <i className="tp-answer-pointer" data-annotation="teacher" aria-hidden="true">↘</i>}</button>; })}</div><footer className="tp-paper-footer"><span>Weekend plans</span><span>28</span></footer>{annotations.layer}{celebrating && <Fireworks key={interaction.awardId} />}</article></div>
        <aside className="tp-call-rail" aria-label="课堂成员">
          <section className={`tp-call-tile tp-call-teacher ${speaking ? 'is-speaking' : ''} ${screen === '08' ? 'is-thinking' : ''} ${paused ? 'is-muted' : ''} ${reconnecting ? 'is-connecting' : ''}`} aria-label="Teeko 老师窗口">
            <ConnectionBadge owner="老师" quality={participantConnection('teacher', teacherConnection, studentConnection, reconnecting)} open={connectionDetails === 'teacher'} onToggle={() => setConnectionDetails(connectionDetails === 'teacher' ? null : 'teacher')} /><div className="tp-call-teacher-stage"><div className="tp-call-room-window" aria-hidden="true" /><div className="tp-call-room-shelf" aria-hidden="true"><i /><i /><i /><span /></div><Bird pose={pose} />{screen === '08' && <span className="tp-call-thinking" aria-hidden="true"><i /><i /><i /></span>}</div>
            <div className="tp-call-namebar"><div><strong>Teeko 老师</strong><span>{teacherState}</span></div>{speaking ? <span className="tp-call-wave" aria-hidden="true">{[8, 17, 12, 22, 14].map((h, i) => <i key={i} style={{ height: h, animationDelay: `${i * 110}ms` }} />)}</span> : paused ? <MicOff size={16} /> : <Mic size={16} />}</div>
          </section>
          <section className={`tp-call-tile tp-call-child ${waiting && !listening ? 'is-turn' : ''} ${listening ? 'is-listening' : ''} ${screen === '11' ? 'is-interaction-paused' : ''}`} aria-label={`${name} 的窗口`}>
            <ConnectionBadge owner="孩子" quality={participantConnection('student', teacherConnection, studentConnection, reconnecting)} open={connectionDetails === 'student'} onToggle={() => setConnectionDetails(connectionDetails === 'student' ? null : 'student')} /><div className="tp-call-self-stage"><span className="tp-call-self-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase() || 'L'}</span><span className="tp-call-camera-off"><CameraOff size={13} />摄像头关闭</span>{celebrating && <RewardSticker kind={interaction.awardKind} />}</div>
            <div className="tp-call-namebar"><div><strong>{name || 'Leo'}</strong>{childState && <span>{childState}</span>}</div>{listening ? <span className="tp-call-wave" aria-hidden="true">{[12, 20, 9, 16, 11].map((h, i) => <i key={i} style={{ height: h, animationDelay: `${i * 100}ms` }} />)}</span> : <Mic size={16} />}</div>
          </section>
        </aside>
      </div>
      <footer className="tp-call-controls">{annotations.toolbar}<div className="tp-call-main-actions"><button className="tp-call-sound" aria-label={teaching.saved.effects ? '关闭互动音效' : '开启互动音效'} aria-pressed={teaching.saved.effects} onClick={() => { sounds.current.stop(); updateTeaching({ type: 'sound', enabled: !teaching.saved.effects }); }}>{teaching.saved.effects ? <Volume2 size={18} /> : <VolumeX size={18} />}</button><button aria-label="暂停课堂" disabled={reconnecting || paused} onClick={pause}><Pause size={18} />暂停</button><button className="tp-call-end" onClick={() => requestEnd()}><PhoneOff size={18} />结束</button></div></footer>
      {screen === '11' && <div className="tp-lesson-scrim"><section className="tp-pause-menu" role="dialog" aria-modal="true" aria-label="互动暂停"><h2>{pauseInfo.title}</h2><p>{pauseInfo.description}</p><div className="tp-menu-actions"><Button kind="secondary" onClick={() => requestEnd()}>结束课堂</Button><Button onClick={resume}>继续上课<Play size={17} /></Button></div></section></div>}
      {screen === '18' && <div className="tp-lesson-scrim"><section className="tp-pause-menu" role="dialog" aria-modal="true" aria-label="课堂暂停"><h2>课堂已暂停</h2><div className="tp-menu-actions"><Button kind="secondary" onClick={() => requestEnd()}>结束课堂</Button><Button onClick={resume}>继续上课<Play size={17} /></Button></div></section></div>}
      {screen === '19' && <div className="tp-lesson-scrim"><section className="tp-pause-menu" role="dialog" aria-modal="true" aria-label="课堂结束"><h2>{end.title}</h2><p>{end.description}</p><div className="tp-menu-actions">{end.canResume && <Button onClick={cancelEnd}>{endOrigin.current === '20' ? '继续等待' : ['11', '18'].includes(endOrigin.current) ? '返回暂停' : '继续上课'}</Button>}<Button kind={end.canResume ? 'secondary' : 'primary'} className={end.canResume ? 'tp-confirm-exit' : ''} onClick={() => go('12')}>{end.canResume ? '结束并保存' : '查看学习小结'}{end.canResume ? <PhoneOff size={17} /> : <Check size={17} />}</Button></div></section></div>}
      {reconnecting && <div className="tp-reconnect-notice"><Wifi size={20} /><div><strong>连接暂时断开，进度还在。</strong><p>这里演示重连，不会连接真实语音。</p></div><Button kind="secondary" onClick={restoreConnection}>模拟恢复</Button><Button kind="ghost" onClick={() => go(prototypeDestination('reconnect-failed', mode))}>返回选课</Button></div>}
    </div>;
  }

  function renderScreen(): ReactNode {
    if (screen === '00') return <MarketingLanding state={auth} onChange={setAuth} onEnter={intent => { setAuth(current => navigatePrototypeAuth(current, intent)); go(prototypeDestination('landing-enter', mode)); }} onAgreement={() => setDialog({ title: '用户协议', body: '协议内容待正式发布前确认。本页仅演示协议入口，不提交同意记录。' })} />;
    if (['06', '07', '08', '09', '10', '11', '18', '19', '20'].includes(screen)) return lesson();
    if (screen === '01') return <div className="tp-auth">
      <section className="tp-auth-story"><Brand onClick={() => go('00')} /><div className="tp-auth-copy"><Chip>8–13 岁 · 英语口语</Chip><h1>让孩子<br />自在地开口。</h1><p>一位有耐心的老师，<br />一页熟悉的课本，一次小小的进步。</p></div><div className="tp-auth-bird"><Bird pose="handoff" /></div></section>
      <PrototypeAuthForm state={auth} onChange={setAuth} onAuthenticated={destination => go(destination === 'profile' ? '02' : '03')} onDemo={demo} onAgreement={() => setDialog({ title: '用户协议', body: '协议内容待正式发布前确认。本页仅演示协议入口，不提交同意记录。' })} />
    </div>;
    if (screen === '02') return <><AppHeader title="孩子档案" backTo="01" actions={false} /><div className="tp-page tp-profile-page">
      <Heading eyebrow="一起认识一下" title="Teeko 该怎么称呼孩子？" />
      <div className="tp-profile-grid"><section className="tp-card tp-profile-details"><div className="tp-form-grid">
        <label>孩子的称呼<input value={name} onChange={e => setName(e.target.value)} maxLength={12} placeholder="中文或英文名" /></label>
        <fieldset className="tp-profile-field"><legend>年龄</legend><div className="tp-age-options">{AGE_RANGES.map(range => <label key={range} className={`tp-profile-choice ${age === range ? 'is-selected' : ''}`}><input type="radio" name="tp-age" value={range} checked={age === range} onChange={() => setAge(range)} /><span>{range} 岁</span></label>)}</div></fieldset>
        <fieldset className="tp-profile-field tp-form-span"><legend>孩子能用英语做什么？</legend><div className="tp-level-options">{PROFILE_LEVELS.map(option => <label key={option.id} className={`tp-profile-choice tp-level-choice ${level === option.id ? 'is-selected' : ''}`}><input type="radio" name="tp-english-level" value={option.id} checked={level === option.id} onChange={() => setLevel(option.id)} /><span><strong>{option.title}</strong><small>{option.example}</small></span></label>)}</div></fieldset>
      </div></section><aside className="tp-profile-aside"><Bird /><h3>Hi, {name || 'Leo'}!</h3><p>我会听你说完，<br />也会陪你换一种方法试试。</p></aside></div>
      <footer className="tp-page-actions"><p>以后可以在“我的”里修改。</p><Button onClick={() => { if (!name.trim()) return setError('请填写孩子的称呼。'); setAuth(markPrototypeProfileComplete); go(history.at(-1) === '25' ? '25' : prototypeDestination('profile-saved', mode)); }}>准备好了，开始吧<ArrowRight size={18} /></Button>{error && <span role="alert">{error}</span>}</footer>
    </div></>;
    if (screen === '03' || screen === '16') return <><AppHeader reports={false} /><div className="tp-page tp-home-page"><Heading title={`Hi, ${name}。今天想聊些什么？`} /><div className="tp-home-grid"><section className="tp-continue-card"><div><Chip>{screen === '16' ? '第一课 · 认识 Teeko' : '接着上次，轻松开始'}</Chip><h2>{screen === '16' ? '先和 Teeko 打个招呼' : 'What’s your weekend plan?'}</h2><p>{screen === '16' ? '认识课堂操作，试试怎么和老师聊天。' : '课程 03 · Weekend plans · 第 2 页'}</p><div className="tp-progress-track"><span style={{ width: screen === '16' ? '0%' : '42%' }} /></div><div className="tp-home-start-actions"><Button kind="accent" onClick={() => { setFirstLesson(screen === '16'); go(screen === '16' ? '14' : '05'); }}>{screen === '16' ? '开始第一课' : '继续上课'}<ArrowRight size={18} /></Button><Button kind="secondary" onClick={() => go('04')}>我的课程列表<BookOpen size={18} /></Button></div></div><Bird pose="handoff" /></section><aside className="tp-home-stats"><Metric value={screen === '16' ? '0' : '42'} label="本周练习分钟" /><Metric value={screen === '16' ? '0' : '3'} label="本周上课次数" /></aside></div><div className="tp-section-heading"><h3>最近的课</h3><button onClick={() => go('23')}>全部报告<ArrowUpRight size={15} /></button></div>{screen === '16' ? <div className="tp-empty-inline"><BookOpen size={27} /><p>第一节课结束后，进步会记在这里。</p></div> : <div className="tp-recent-grid">{REPORTS.slice(0, 3).map(r => <button className="tp-card tp-recent-card" key={r.title} onClick={() => report(r.variant)}><span className="tp-small">{r.date}</span><h3>{r.title}</h3><span>15 分钟 <i /> {r.state}<ChevronRight size={15} /></span></button>)}</div>}</div></>;
    if (screen === '04') {
      const course = COURSE_INTROS[courseIndex];
      return <><AppHeader title="选一课" backTo="03" /><div className="tp-page tp-course-page">
        <Heading title="今天想学什么？" />
        <div className="tp-lessons-grid"><nav className="tp-course-list" aria-label="课程主题">{COURSE_TITLES.map((title, i) => <button key={title} aria-current={courseIndex === i ? 'true' : undefined} className={courseIndex === i ? 'is-active' : ''} onClick={() => setCourseIndex(i)}><span>{String(i + 1).padStart(2, '0')}</span><div><strong>{title}</strong><small>{i < 2 ? '已学过' : i === 2 ? '学到第 2 页' : '还没开始'}</small></div>{i < 2 && <Check size={16} />}</button>)}</nav>
          <article className="tp-card tp-course-intro" aria-label={`${COURSE_TITLES[courseIndex]}课程介绍`}>
            <div className="tp-course-intro-top"><div><span className="tp-eyebrow">COURSE {String(courseIndex + 1).padStart(2, '0')}</span><h2>{COURSE_TITLES[courseIndex]}</h2><span className="tp-course-english">{course.title}</span><p>{course.description}</p></div><Bird pose="handoff" /></div>
            <div className="tp-course-topics"><h3>这节课会聊到</h3><div>{course.topics.map(topic => <Chip soft key={topic}>{topic}</Chip>)}</div></div>
            <div className="tp-course-language"><div><h3>会用到的词</h3><p>{course.words}</p></div><div><h3>试着这样说</h3><p>{course.expression}</p></div></div>
            <footer className="tp-course-start"><span className="tp-small"><Clock size={15} />约 10–15 分钟</span><Button onClick={startCourse}>跟 Teeko 老师一起学<ArrowRight size={18} /></Button></footer>
          </article>
        </div>
      </div></>;
    }
    if (screen === '14' || screen === '05' || screen === '15') return <><AppHeader title="准备上课" backTo="04" actions={false} /><div className="tp-page tp-check-page"><Heading title={screen === '14' ? '上课前，我们需要麦克风。' : screen === '15' ? '还没听到你的声音。' : '准备好，就可以开口了。'} description={screen === '14' ? '只在练习时使用声音。摄像头不开，也能完整上课。' : screen === '15' ? '先检查一下麦克风，再回来试试。' : undefined} /><div className="tp-setup-grid"><div className="tp-setup-art tp-setup-preview" aria-label={`${name || 'Leo'} 的课堂小窗预览`}><div className="tp-setup-preview-stage"><span className="tp-setup-preview-avatar" aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || 'L'}</span></div><div className="tp-setup-preview-namebar"><strong>{name || 'Leo'}</strong><span><CameraOff size={14} />摄像头已关闭</span></div></div><section className="tp-card tp-check-card">{screen === '14' ? <><Row icon={<Mic />} title="麦克风：上课需要" description="听到孩子的回答，让 Teeko 接住每一句。" /><Row icon={<CameraOff />} title="摄像头：本阶段不开启" description="小窗显示头像，不采集画面。" /><div className="tp-privacy-note"><ShieldCheck size={20} /><p>这是页面流演示。点击下一步不会弹出系统权限，也不会录音。</p></div></> : screen === '15' ? <><div className="tp-error-icon"><Mic size={30} /></div><h3>麦克风未开启</h3><p>电脑：点击地址栏的网站设置，允许麦克风。<br />平板：在浏览器的网站设置中检查权限。</p><p className="tp-small">也可以确认耳机连接与系统输入设备。正式实现时会按设备给出设置路径。</p></> : <>{[[<Mic key="m" />, '麦克风', '声音清楚'], [<Wifi key="w" />, '网络', '连接顺畅'], [<Headphones key="h" />, 'Teeko 回话', '可以开始']].map(([icon, label, value], i) => <Row key={i} icon={icon} title={String(label)}><span className="tp-check-good"><Check size={16} />{value}</span></Row>)}<Row icon={<CameraOff />} title="摄像头"><span className="tp-small">未开启</span></Row></>}</section></div><footer className="tp-page-actions">{screen === '14' ? <Button onClick={() => go('05')}>好的，下一步<ArrowRight size={18} /></Button> : screen === '15' ? <Button onClick={() => go('05')}><RotateCcw size={17} />重新检查</Button> : <><Button onClick={() => go(prototypeDestination('checks-passed', mode, firstLesson))}>开始上课<ArrowRight size={18} /></Button></>}</footer></div></>;
    if (screen === '17') return <><AppHeader title="第一课 · 认识 Teeko" backTo="04" actions={false} /><div className="tp-page tp-intro-page"><div className="tp-intro-top"><Bird pose={tab === 0 ? 'handoff' : 'idle-listening'} /><div><span className="tp-eyebrow">HI, {name.toUpperCase()}!</span><h1>{tab === 0 ? '你可以随时打断我。' : '试一试，选出你想说的话。'}</h1><p>{tab === 0 ? '想说话时直接开口，想休息就点暂停。' : '这里只演示定级方式，不生成真实水平评价。'}</p></div></div><Tabs tab={tab} onChange={value => { setTab(value); setError(''); }} values={['课堂操作', '试试难度']} />{tab === 0 ? <div className="tp-command-grid">{[['Speak', '想说话时直接开口'], ['Pause', '点底部“暂停”']].map(([en, zh]) => <button key={en} className="tp-card" onClick={() => demo(`演示指令：${zh}`)}><Volume2 size={22} /><strong>{en}</strong><span>{zh}</span></button>)}</div> : <div className="tp-card tp-placement"><span className="tp-small">示例题 · 1 / 3（题数待确定）</span><h2>What are you going to do this weekend?</h2><div className="tp-option-row">{['Visit a museum.', 'I’m not sure yet.', '换一个简单点的'].map(v => <button key={v} onClick={() => demo('已选择。这里只预览定级交互，未评估能力。')}>{v}</button>)}</div></div>}<footer className="tp-page-actions"><span className="tp-small">不会也没关系，Teeko 会换个方法。</span><Button onClick={() => { if (tab === 0) setTab(1); else { setFirstLesson(false); go('06'); } }}>{tab === 0 ? '试试小问题' : '进入课堂'}<ArrowRight size={18} /></Button></footer></div></>;
    return renderRemaining();
  }

  function renderRemaining(): ReactNode {
    if (screen === '12') return <><AppHeader title="这次的小进步" actions={false} /><div className="tp-page tp-summary"><div className="tp-summary-intro"><Bird pose="celebrate" /><div><span className="tp-eyebrow">GOOD WORK, {name.toUpperCase()}.</span><h1>今天，你说出了新的句子。</h1><p>“I’m going to visit the science museum.”</p></div></div><div className="tp-card tp-summary-card"><div className="tp-metrics"><Metric value="12 分钟" label="这次练习" /><Metric value="24 次" label="尝试开口" /><Metric value="6 个" label="遇到的新词" /></div><div className="tp-takeaway"><Check size={20} /><div><strong>会说一句周末计划了</strong><p>下次，我们可以用它说说你真正想去的地方。</p></div></div></div><div className="tp-report-status"><FileText size={20} /><div><strong>{variant === 'pending' ? '学习报告整理中' : variant === 'failed' ? '详细报告暂时没生成' : '学习报告已准备好'}</strong>{variant === 'pending' ? <p>可能需要几分钟，稍后可在全部报告查看。</p> : variant === 'failed' ? <p>学习进度已保存，可以稍后重试。</p> : null}</div><Button kind="secondary" onClick={() => report(variant)}>{variant === 'pending' ? '查看进度' : '查看报告'}<ChevronRight size={16} /></Button></div><footer className="tp-page-actions"><Button kind="secondary" onClick={() => go('04')}>再选一课</Button><Button onClick={home}>今天学到这里<Check size={18} /></Button></footer></div></>;
    if (screen === '13') return <><AppHeader title="单节学习报告" backTo="23" /><div className="tp-page tp-report-page"><div className="tp-section-heading"><Heading eyebrow="今天 · 16:30 / 演示报告" title="Weekend plans" /><Chip soft>{variant === 'brief' ? '简版报告' : '课程 03 · 周末计划'}</Chip></div>{variant === 'pending' || variant === 'failed' ? <div className="tp-empty tp-card tp-report-empty"><Bird pose="thinking" /><h2>{variant === 'pending' ? 'Teeko 正在整理这节课。' : '这次报告没有生成成功。'}</h2><p>课程进度已经保留，不影响下次学习。</p><Button kind="secondary" onClick={() => { setVariant('normal'); demo('已切换到报告成功的模拟状态。'); }}>{variant === 'pending' ? '模拟生成完成' : '重试生成'}<RotateCcw size={16} /></Button></div> : <><Tabs tab={tab} onChange={value => { setTab(value); setError(''); }} values={['学习概览', '再练一点', '练习建议']} />{tab === 0 ? <div className="tp-report-grid"><section className="tp-card"><h3>这一次的表达</h3><div className="tp-metrics"><Metric value="12 min" label="练习时长" /><Metric value="24" label="开口次数" /><Metric value="3" label="主动提问" /></div><div className="tp-progress-caption"><span>从听懂，到自己说</span><span>示例观察</span></div><div className="tp-observation"><i /><i /><i /><i /><i className="is-light" /></div><p>开始时需要中文提示，后来能主动补充想去的地方。</p></section><section className="tp-card tp-report-quote"><Chip>Teeko 的一句话</Chip><h2>“他把新句子，<br />变成了自己的计划。”</h2><p>今天先肯定主动表达，下次再自然地练习 telescope 的重音。</p><span className="tp-small">以上为演示观察，不是实际能力评估。</span></section></div> : tab === 1 ? <div className="tp-report-grid"><section className="tp-card"><h3>一个值得再听的词</h3><div className="tp-big-word">telescope<button className="tp-icon-button" aria-label="播放示例读音" onClick={() => demo('读音按钮演示，尚未接入音频。')}><Volume2 size={22} /></button></div><p>重音在第一个音节：TEL·e·scope</p><div className="tp-example">I’m going to see a big telescope.</div><p className="tp-small">先听一个示范，愿意时再试；跳过不记作掌握。</p></section><section className="tp-card"><h3>这节课遇到的词</h3><div className="tp-word-tags">{WORDS.map(([en, zh]) => <div key={en}>{en}<span>{zh}</span></div>)}</div></section></div> : variant === 'brief' ? <section className="tp-card tp-advice-empty"><FileText size={26} /><h3>本次记录不足，暂不生成练习建议。</h3><p>有具体的卡点或纠正记录后，再给出对应练法。</p></section> : <div className="tp-recommendations" aria-label="基于本课记录的练习建议">{DEMO_RECOMMENDATIONS.map(item => <section className="tp-card tp-recommendation" key={item.focus}><header><h3>{item.focus}</h3><Chip soft>{item.kind}</Chip></header><dl><div><dt>课堂表现</dt><dd>{item.observation}</dd></div><div><dt>老师处理</dt><dd>{item.correction}</dd></div><div><dt>随后表现</dt><dd>{item.result}</dd></div></dl><div className="tp-recommendation-practice"><h4>建议怎么练</h4><p>{item.practice}</p><div className="tp-recommendation-example" lang="en">{item.example}</div></div></section>)}</div>}</>}<footer className="tp-page-actions"><span className="tp-small">示例数据 · 不代表真实评分或掌握结论。</span></footer></div></>;
    if (screen === '21') return <><AppHeader title="这一页完成了" actions={false} /><div className="tp-page tp-centered-page"><Bird pose="celebrate" /><h1>{variant === 'limit' ? '今天的学习时间用完了。' : '这一页学完了。'}</h1><p>{variant === 'limit' ? '进度已保存，明天可以继续。' : '继续这一课，或者今天先学到这里。'}</p><div className="tp-centered-actions"><Button kind="secondary" onClick={() => go('12')}>结束这节课</Button>{variant !== 'limit' && <Button onClick={() => go('06')}>继续学习<ArrowRight size={18} /></Button>}</div></div></>;
    if (screen === '23') return <><AppHeader title="学习报告" backTo="03" /><div className="tp-page"><div className="tp-section-heading"><Heading eyebrow="每次开口，留下一个脚印" title="看得见的小进步。" description="按次查看，不排名，不追着分数跑。" /><Chip soft>共 6 次 · 演示记录</Chip></div><div className="tp-report-list tp-card">{REPORTS.slice(reportPage * 4, reportPage * 4 + 4).map((r, i) => <button key={r.title} onClick={() => report(r.variant)}><span className="tp-report-index">{String(reportPage * 4 + i + 1).padStart(2, '0')}</span><div><strong>{r.title}</strong><span>{r.date} · 12 分钟</span></div><Chip soft>{r.state}</Chip><ChevronRight size={20} /></button>)}</div><footer className="tp-page-actions"><span className="tp-small">生成失败可重试，等待中的报告不阻止下一节课。</span><div className="tp-pagination"><button className="tp-icon-button" aria-label="上一页报告" disabled={reportPage === 0} onClick={() => setReportPage(0)}><ChevronLeft size={20} /></button><span>{reportPage + 1} / 2</span><button className="tp-icon-button" aria-label="下一页报告" disabled={reportPage === 1} onClick={() => setReportPage(1)}><ChevronRight size={20} /></button></div></footer></div></>;
    if (screen === '25') return <><AppHeader title="我的" backTo="03" /><div className="tp-page"><div className="tp-profile-banner"><span className="tp-profile-avatar">{name.slice(0, 1).toUpperCase()}</span><div><span className="tp-eyebrow">HI, {name.toUpperCase()}</span><h1>照着自己的节奏，一点点来。</h1><p>{age} 岁 · 演示档案</p></div><Button kind="secondary" onClick={() => go('02')}>编辑档案</Button></div><div className="tp-settings-grid"><section className="tp-card"><h3>我的学习</h3><Row icon={<FileText />} title="学习报告" description="每一次练习，留下什么" onClick={() => go('23')} /></section><section className="tp-card"><h3>设置与支持</h3><Row icon={<Settings />} title="教学偏好" description="语言、风格、语音服务与音效" onClick={() => go('27')} /><Row icon={<HelpCircle />} title="帮助与反馈" description="使用问题，一起解决" onClick={() => go('29')} /><Row icon={<ShieldCheck />} title="隐私说明" description="查看与管理孩子的数据" onClick={() => go('28')} /></section></div><footer className="tp-page-actions"><span className="tp-small">一个账号对应一个孩子 · 版本预览</span><button className="tp-text-button" onClick={() => setDialog({ title: '退出当前演示账号？', body: '这里只返回登录页，不会操作真实账号。', confirm: '退出演示', action: () => go('01') })}><LogOut size={16} />退出登录</button></footer></div></>;
    if (screen === '27') return <><AppHeader backTo="25" actions={false} /><div className="tp-page tp-teaching-page"><Heading title="教学偏好" /><TeachingSettings value={teaching.draft} onChange={value => { if (value.effects === false) { previewEpoch.current++; sounds.current.stop(); } updateTeaching({ type: 'change', value }); }} onSave={() => { updateTeaching({ type: 'save' }); demo('已保存教学偏好。'); }} onPreview={() => { const request = ++previewEpoch.current; void sounds.current.play('celebrate').then(played => { if (!played && request === previewEpoch.current) demo('浏览器未播放音效，请点击试听重试。'); }); }} /></div></>;
    if (screen === '28') return <><AppHeader title="隐私与数据" backTo="25" actions={false} /><div className="tp-page"><Heading eyebrow="孩子的数据，家长有选择权" title="只留下需要的，也允许删除。" /><Tabs tab={tab} onChange={value => { setTab(value); setError(''); }} values={['数据管理', '信息如何使用']} /><section className="tp-card tp-settings-panel">{tab === 0 ? <><Row icon={<Mic />} title="允许保留练习录音" description="默认关闭；正式留存规则、用途和期限待确定。"><Switch label="允许保留练习录音" checked={recording} onChange={() => setRecording(!recording)} /></Row><Row icon={<Trash2 />} title="删除学习记录" description="演示：清除报告与学习进度"><Button kind="secondary" onClick={() => setDialog({ title: '删除所有学习记录？', body: '正式功能不可恢复，需单独确认。本次仅演示确认过程，不删除任何真实数据。', confirm: '模拟删除', action: () => demo('已完成模拟删除，真实学习记录未操作。') })}>删除记录</Button></Row><Row icon={<User />} title="注销账号" description="正式功能需验证家长身份，处理规则待确认。"><Button kind="ghost" onClick={() => setDialog({ title: '申请注销账号', body: '正式流程需要邮箱验证、数据处理说明与最终确认。本原型只展示申请入口，不提交注销。', confirm: '模拟申请', action: () => demo('注销申请演示已完成，未提交任何请求。') })}>注销账号</Button></Row></> : <><Row icon={<Mic />} title="声音用于课堂交流" description="原型不访问麦克风；正式服务的数据流与留存规则另行确认。" /><Row icon={<CameraOff />} title="当前不使用摄像头" description="孩子小窗是头像，不采集或上传视频。" /><Row icon={<ShieldCheck />} title="家长可管理与删除" description="具体范围、期限与身份验证将在正式规则中说明。" /><Row icon={<Lock />} title="不把原型当作正式协议" description="这里是信息结构演示，发布文案需要独立确认。" /></>}</section><footer className="tp-page-actions"><span className="tp-small">所有操作为演示，不上传或删除真实数据。</span><Button kind="secondary" onClick={() => go('25')}>返回我的</Button></footer></div></>;
    return <><AppHeader title="帮助与反馈" backTo="25" /><div className="tp-page"><Heading eyebrow="遇到问题，我们一起看" title="让下一次开口更顺畅。" /><Tabs tab={tab} onChange={value => { setTab(value); setError(''); }} values={['常见问题', '告诉我们']} />{tab === 0 ? <div className="tp-help-grid"><nav className="tp-card tp-faq-list">{['听不到 Teeko 的声音', 'Teeko 听不到我', '网络断开了怎么办', '孩子不想重复练习', '摄像头一定要开吗'].map((q, i) => <button className={Number(word || '0') === i ? 'is-active' : ''} key={q} onClick={() => setWord(String(i))}>{q}<ChevronRight size={16} /></button>)}</nav><section className="tp-card tp-faq-answer"><HelpCircle size={28} /><h2>{['先看看声音去了哪里。', '确认麦克风选对了。', '进度在，别着急。', '可以换个方式，也可以先停下。', '不需要，头像也能上课。'][Number(word || '0')]}</h2><p>{['检查电脑或平板的音量、静音和蓝牙耳机输出。可以结束课堂后重新做开课检查。', '在浏览器的网站设置允许麦克风，再检查系统输入设备。接入后会按浏览器提供具体指引。', '课堂会暂停并尝试重连。恢复后从保留的进度继续；仍不能恢复，可以返回选课。', '老师应接受拒绝，不循环逼读。提供跳过、换活动或结束，跳过不记作掌握。', '当前版本使用孩子头像，不开启摄像头，也不上传画面。视频感知属于后续阶段。'][Number(word || '0')]}</p><Button kind="secondary" onClick={() => setTab(1)}>还没解决？写反馈<MessageCircle size={17} /></Button></section></div> : <section className="tp-card tp-feedback">{feedbackSent ? <div className="tp-feedback-done"><Check size={30} /><h2>谢谢你告诉我们。</h2><p>原型已展示提交结果，未发送或保存反馈。</p><Button kind="secondary" onClick={() => { setFeedbackSent(false); setFeedback(''); }}>再写一条</Button></div> : <><label>你遇到了什么？<textarea value={feedback} onChange={e => setFeedback(e.target.value)} maxLength={500} placeholder="可以描述发生在哪一步，以及你原本期待什么。请勿填写手机号等隐私信息。" /></label><span className="tp-small">{feedback.length} / 500 · 原型不会发送内容或诊断信息。</span><Button disabled={!feedback.trim()} onClick={() => setFeedbackSent(true)}>模拟提交反馈<ArrowRight size={17} /></Button></>}</section>}<footer className="tp-page-actions"><span className="tp-small">帮助文案是初稿，设备设置指引会在接入后验证。</span><button className="tp-text-button" onClick={() => go('15')}>查看开课检查失败页<ArrowUpRight size={16} /></button></footer></div></>;
  }

  const classScreen = ['06', '07', '08', '09', '10', '11', '18', '19', '20'].includes(screen);
  const reviewClass = classScreen && !['11', '18', '19'].includes(screen);
  const statusVariants = screen === '12' || screen === '13' ? [['normal', '正常'], ['pending', '生成中'], ['failed', '失败'], ['brief', '简版']] : screen === '21' ? [['normal', '可继续'], ['limit', '当日上限']] : [];
  return <div className="tk-prototype">
    <header className="tp-review-bar"><div className="tp-review-title"><strong>Teeko</strong><span>页面流原型</span><span className="tp-demo-badge">课堂演示 · 可检测连接</span></div><nav><button className={view === 'overview' ? 'is-active' : ''} onClick={() => { setAuth(leavePrototypeAuth); setView('overview'); setDirectory(false); window.history.replaceState(null, '', window.location.pathname); }}><LayoutGrid size={16} />全貌</button><select aria-label="选择审阅路线" value="" onChange={e => journey(e.target.value as 'new' | 'daily' | 'error' | 'parent')}><option value="" disabled>走一遍流程</option><option value="new">首次上课</option><option value="daily">日常学习</option><option value="error">异常恢复</option><option value="parent">家长查看</option></select><div className="tp-device-picker"><button aria-label="电脑布局" aria-pressed={device === 'desktop'} className={device === 'desktop' ? 'is-active' : ''} onClick={() => setDevice('desktop')}><Monitor size={17} /></button><button aria-label="平板布局" aria-pressed={device === 'tablet'} className={device === 'tablet' ? 'is-active' : ''} onClick={() => setDevice('tablet')}><Tablet size={17} /></button></div><select aria-label="原型范围" value={mode} onChange={e => setMode(e.target.value as PrototypeMode)}><option value="full">完整页面流</option><option value="p0">P0 跳转</option></select><button aria-expanded={directory} className={directory ? 'is-active' : ''} onClick={() => { setDirectory(!directory); setView('player'); }}><MoreHorizontal size={18} />目录</button></nav></header>
    {view === 'overview' ? <main className="tp-overview"><div className="tp-overview-heading"><div><span className="tp-eyebrow">FRONTEND WALKTHROUGH · {PROTOTYPE_SCREENS.length} SCREENS</span><h1>先走一遍，再一起打磨。</h1><p>电脑与平板的响应式网页。主操作留在一屏，长内容按页签与分页展开。</p></div><Bird pose="handoff" /></div><div className="tp-journeys">{([['new', '01', '首次上课', '落地页 → 邀请注册 → 档案 → 课堂'], ['daily', '02', '日常学习', '接着学 → 课堂 → 小结 → 报告'], ['error', '03', '异常恢复', '设备失败 → 重试 → 断线恢复'], ['parent', '04', '家长查看', '报告 → 设置 → 数据与反馈']] as const).map(([key, index, title, desc]) => <button key={key} onClick={() => journey(key)}><span>{index}</span><div><strong>{title}</strong><small>{desc}</small></div><ArrowUpRight size={18} /></button>)}</div><div className="tp-flow-columns">{GROUPS.map(g => <section key={g}><div className="tp-flow-group-heading"><h2>{g}</h2><span>{PROTOTYPE_SCREENS.filter(s => s.group === g).length} 屏</span></div>{PROTOTYPE_SCREENS.filter(s => s.group === g).map(s => <button key={s.id} onClick={() => go(s.id)}><span className="tp-screen-id">{s.id}</span><strong>{s.title}</strong><span className={`tp-phase tp-phase-${s.phase.toLowerCase()}`}>{s.phase}</span><ChevronRight size={14} /></button>)}</section>)}</div><p className="tp-overview-note">P0 / P1 / P2 是计划阶段。本次统一预览界面，后续功能与模型能力尚未接入。课堂状态可在底部切换。</p></main> : <main className="tp-review-workspace">{directory && <aside className="tp-review-directory"><div className="tp-directory-heading"><strong>页面目录</strong><button aria-label="关闭目录" onClick={() => setDirectory(false)}><X size={16} /></button></div><div className="tp-directory-groups">{GROUPS.map(g => <button className={group === g ? 'is-active' : ''} key={g} onClick={() => setGroup(g)}>{g}</button>)}</div><nav>{PROTOTYPE_SCREENS.filter(s => s.group === group).map(s => <button key={s.id} className={screen === s.id ? 'is-active' : ''} onClick={() => go(s.id)}><span>{s.id}</span><strong>{s.title}</strong><small>{s.phase}</small></button>)}</nav><p>目录是审阅工具。产品内的按钮沿场景跳转。</p></aside>}<div className={`tp-frame-host tp-device-${device}`}><div className="tp-app-frame" ref={frame} data-compact={compact} data-device={device}>{renderScreen()}{toast && <div className="tp-toast" role="status"><Check size={17} />{toast}<button aria-label="关闭提示" onClick={() => setToast('')}><X size={14} /></button></div>}{dialog && <div className="tp-modal-scrim"><section className="tp-dialog" role="dialog" aria-modal="true" aria-label={dialog.title}><button className="tp-dialog-close tp-icon-button" aria-label="关闭弹窗" onClick={() => setDialog(null)}><X size={19} /></button><ShieldCheck size={26} /><h2>{dialog.title}</h2><p>{dialog.body}</p><div className="tp-menu-actions">{dialog.confirm && <Button kind="secondary" onClick={() => setDialog(null)}>取消</Button>}<Button onClick={() => { const action = dialog.action; setDialog(null); action?.(); }}>{dialog.confirm || '知道了'}</Button></div></section></div>}</div></div></main>}
    <footer className="tp-review-footer"><div className="tp-review-screen-label">{view === 'overview' ? <><span className="tp-status-dot" />可点击的前端草稿<span className="tp-footer-note">先审页面流，再接真实能力</span></> : <><span className="tp-screen-id">{info.id}</span><strong>{info.title}</strong><span className={`tp-phase tp-phase-${info.phase.toLowerCase()}`}>{info.phase}</span><span className="tp-footer-note">{info.note}</span></>}</div>{view === 'player' && <div className="tp-state-controls">{(screen === '00' || screen === '01') && <button onClick={() => setDialog({ title: '原型示例邀请码', body: 'TEEKO-TRY、TEEKO-NEXT：有效，各可注册一次；TEEKO-EXPIRED：过期；TEEKO-OFF：停用。其余输入无效。邀请码和账号仅在当前原型内存有效，刷新重置；正式发码、校验和兑换尚未接入。' })}>示例邀请码</button>}{screen === '05' && <button onClick={() => go('15')}>检查失败</button>}{reviewClass && ['06', '07', '08', '09', '10', '18', '20', '21'].map(id => <button key={id} className={screen === id ? 'is-active' : ''} onClick={() => go(id as PrototypeScreenId)}>{({ '06': '老师讲', '07': '轮到你', '08': '思考', '09': '卡住', '10': '纠音', '18': '暂停', '20': '断线', '21': '页完成' } as Record<string, string>)[id]}</button>)}{screen === '07' && <button className={variant === 'listening' ? 'is-active' : ''} onClick={() => setVariant(variant === 'listening' ? 'normal' : 'listening')}>正在听</button>}{statusVariants.map(([v, label]) => <button className={variant === v ? 'is-active' : ''} key={v} onClick={() => setVariant(v as Variant)}>{label}</button>)}{screen === '11' && INTERACTION_PAUSES.map(item => <button key={item.id} className={interactionPause === item.id ? 'is-active' : ''} onClick={() => setInteractionPause(item.id)}>{item.label}</button>)}{screen === '19' && END_REASONS.map(item => <button key={item.id} className={endReason === item.id ? 'is-active' : ''} onClick={() => setEndReason(item.id)}>{item.label}</button>)}{reviewClass && <select aria-label="课堂情景" value="" onChange={event => { interactionScenario(event.target.value); }}><option value="" disabled>课堂情景</option><optgroup label="互动效果"><option value="choose">点选答题</option><option value="circle">画笔圈出答案</option><option value="praise" disabled={!canInteract || celebrating}>讲得好 · 鼓励烟花</option></optgroup><option value="interaction">互动暂停</option>{END_REASONS.filter(item => item.id !== 'manual').map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}{reviewClass && <select aria-label="连接情景" value="" onChange={event => { const [side, quality] = event.target.value.split(':'); changeConnection(side as 'teacher' | 'student', quality as ConnectionQuality); }}><option value="" disabled>连接情景</option>{(['teacher', 'student'] as const).map(side => <optgroup key={side} label={side === 'teacher' ? '老师连接' : '孩子连接'}>{Object.entries(CONNECTION_LABELS).map(([value, label]) => <option key={value} value={`${side}:${value}`}>{side === 'teacher' ? '老师' : '孩子'} · {label}</option>)}</optgroup>)}</select>}<span className="tp-review-nav"><button aria-label="审阅上一屏" disabled={screen === '00'} onClick={() => go(PROTOTYPE_SCREENS[screenIndex - 1].id)}><ChevronLeft size={17} /></button><button aria-label="审阅下一屏" disabled={screen === '29'} onClick={() => go(PROTOTYPE_SCREENS[screenIndex + 1].id)}><ChevronRight size={17} /></button></span></div>}</footer>
  </div>;
}
