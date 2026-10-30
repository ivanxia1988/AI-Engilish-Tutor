"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, AudioLines, BookOpen, Check, CheckCheck, ChevronRight, Circle, CircleHelp, Clock3, Flower2, Headphones, Leaf as LeafIcon, LoaderCircle, MessageCircle, Mic, MoreHorizontal, Pause, Pencil, Play, Plus, RotateCcw, Send, Settings2, ShieldCheck, Sprout, Star, Trash2, Undo2, Volume2, VolumeX, X } from "lucide-react";
import { NetworkNotice } from "@/components/network-notice";
import { VoiceProviderPicker, resolvedVoiceStatuses } from "@/components/voice-provider-picker";
import { voiceProvider, VOICE_PROVIDERS, type VoiceProviderId, type VoiceProviderStatus } from "@/lib/voice-provider";
import { PerformancePanel } from "@/components/performance-panel";
import { clearPerformanceReports } from "@/lib/live-performance";
import { TeacherAvatar } from "@/components/teacher-avatar";
import { Leaf } from "@/components/leaf";
import { Modal } from "@/components/modal";
import { MaterialCanvas } from "@/components/material-canvas";
import { UploadDialog } from "@/components/upload-dialog";
import { LiveVoicePanel } from "@/components/live-voice-panel";
import { LiveConnectionProbe } from "@/components/live-connection-probe";
import { useLiveClassroom } from "@/hooks/use-live-classroom";
import { liveToolSchema, type LiveContext, type LiveToolCall } from "@/lib/live-protocol";
import type { ServerPerformance } from '@/lib/server-timing';
import { createDemoBook } from "@/lib/demo";
import { lessonStats, matchesSpeech, pointsBox, recordAnswer, resolveSelection } from "@/lib/classroom";
import { storage } from "@/lib/storage";
import { classroomSnapshot } from "@/lib/canvas-snapshot";
import { api, speakText, stopSpeech } from "@/lib/browser-speech";
import { defaultSettings, type Book, type Lesson, type Point, type Progress, type Settings, type Stroke, type TeacherReply } from "@/lib/types";

const DEMO = createDemoBook();
const freshProgress = (book: Book, lesson: Lesson): Progress => ({ bookId: book.id, lessonId: lesson.id, stepIndex: 0, completed: false, answers: [], strokes: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
type Message = { role: "teacher" | "child"; text: string };
type ServiceStatus = { configured: boolean; signedIn?: boolean; keyConfigured?: boolean; liveReady?: boolean; voiceProviders?: VoiceProviderStatus[] };
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; onresult: ((e: { results: { transcript: string }[][] }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };

export default function ClassroomApp() {
  const [immersive, setImmersive] = useState(false);
  const [view, setView] = useState<"classroom" | "library" | "journey">("classroom");
  const [books, setBooks] = useState<Book[]>([DEMO]), [bookId, setBookId] = useState(DEMO.id), [lessonId, setLessonId] = useState(DEMO.lessons[0].id);
  const [progress, setProgress] = useState<Progress>(() => freshProgress(DEMO, DEMO.lessons[0])), [allProgress, setAllProgress] = useState<Progress[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings), [ready, setReady] = useState(false), [connected, setConnected] = useState(false), [signedIn, setSignedIn] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(false), [voiceProviders, setVoiceProviders] = useState<VoiceProviderStatus[]>(() => resolvedVoiceStatuses(undefined));
  const [dialog, setDialog] = useState<"upload" | "settings" | "history" | "restart" | "delete" | "clear" | null>(null), [deleteId, setDeleteId] = useState("");
  const [tool, setTool] = useState<"pen" | "circle">("pen"), [color, setColor] = useState("#de8169"), [highlights, setHighlights] = useState<string[]>([]), [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [canvasRevision, setCanvasRevision] = useState(0), [canvasAction, setCanvasAction] = useState<'draw' | 'tap' | 'undo' | 'clear' | 'none'>('none');
  const [reply, setReply] = useState<TeacherReply | null>(null), [showChinese, setShowChinese] = useState(false), [helped, setHelped] = useState(false);
  const [input, setInput] = useState(""), [history, setHistory] = useState<Message[]>([]), [busy, setBusy] = useState(false), [speaking, setSpeaking] = useState(false), [recording, setRecording] = useState(false), [paused, setPaused] = useState(false);
  const [toast, setToast] = useState(""), [error, setError] = useState(""), [seconds, setSeconds] = useState(0);
  const epoch = useRef(0), request = useRef<AbortController | null>(null), recorder = useRef<MediaRecorder | null>(null), streamRef = useRef<MediaStream | null>(null), recognition = useRef<Recognition | null>(null), timer = useRef<ReturnType<typeof setInterval> | null>(null), speakingVersion = useRef(0);
  const book = books.find(b => b.id === bookId) || DEMO, lesson = book.lessons.find(l => l.id === lessonId) || book.lessons[0];
  const step = lesson.steps[Math.min(progress.stepIndex, lesson.steps.length - 1)], page = book.pages.find(p => p.id === step.pageId) || book.pages[0];
  const answer = progress.answers.find(a => a.stepId === step.id), passed = Boolean(answer?.correct), stats = lessonStats(progress);
  const activeEnglish = reply?.english || step.english, activeChinese = reply?.chinese || step.chinese;
  const canUseAI = connected && signedIn;
  const selectedProvider = voiceProvider(settings.voiceProvider);
  const liveReady = Boolean(voiceProviders.find(provider => provider.id === selectedProvider)?.configured);
  const anyVoiceReady = voiceProviders.some(provider => provider.configured);
  const childTasks = lesson.steps.filter(s => s.kind !== "listen").length;
  const live = useLiveClassroom({ tool: executeLiveTool, error: setError, advance: autoAdvance, assistance: noteHelp, provider: selectedProvider });
  const pageStrokes = useMemo(() => progress.strokes.filter(s => s.pageId === page.id && s.stepId === step.id), [progress.strokes, page.id, step.id]);
  const annotations = useMemo(() => ({ revision: canvasRevision, lastAction: canvasAction, markCount: pageStrokes.length, marks: pageStrokes.slice(-6).map(s => ({ id: s.id, tool: s.tool, color: s.color, box: pointsBox(s.points), objectIds: resolveSelection(s.points, page.objects, s.tool).ids })), teacherObjectIds: highlights }), [canvasRevision, canvasAction, pageStrokes, page.objects, highlights]);
  const liveContext: LiveContext = { contextKey: `${book.id}:${lesson.id}:${step.id}`, lessonTitle: lesson.title, age: settings.age, step, objects: page.objects, selectedIds, answered: passed, annotations };
  useEffect(() => { if (live.active) live.update(liveContext); }, [live.active, step.id, passed, selectedIds, page.id, settings.age, annotations]);
  useEffect(() => { if (progress.completed) void live.stop(); }, [progress.completed]);
  useEffect(() => {
    let live = true;
    Promise.all([storage.books(), storage.progress(), storage.settings()]).then(([savedBooks, savedProgress, savedSettings]) => {
      if (!live) return;
      setBooks([DEMO, ...savedBooks.filter(b => b.id !== DEMO.id && b.lessons?.length && b.pages?.length)]);
      setAllProgress(savedProgress); if (savedSettings) setSettings({ ...defaultSettings, ...savedSettings, voiceProvider: voiceProvider(savedSettings.voiceProvider) });
      const resume = savedProgress.find(p => p.bookId === DEMO.id && p.lessonId === DEMO.lessons[0].id); if (resume) setProgress(resume);
    }).catch(e => { if (live) setToast(e.message); }).finally(() => { if (live) setReady(true); });
    api<ServiceStatus>("/api/status").then(s => { if (live) { setConnected(s.configured); setSignedIn(Boolean(s.signedIn)); setKeyConfigured(Boolean(s.keyConfigured)); setVoiceProviders(resolvedVoiceStatuses(s.voiceProviders, Boolean(s.liveReady))); } }).catch(() => { if (live) setToast("服务暂时无法连接，演示课堂仍可使用。"); });
    return () => { live = false; epoch.current++; request.current?.abort(); stopSpeech(); streamRef.current?.getTracks().forEach(t => t.stop()); recognition.current?.abort(); if (timer.current) clearInterval(timer.current); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    setAllProgress(old => [...old.filter(p => !(p.bookId === progress.bookId && p.lessonId === progress.lessonId)), progress]);
    storage.saveProgress(progress).catch(e => setToast(e.message));
  }, [progress, ready]);
  useEffect(() => { if (ready) storage.saveSettings(settings).catch(e => setToast(e.message)); }, [settings, ready]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 5500); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    setReply(null); setSelectedIds([]); setShowChinese(false); setHelped(false); setError(""); setInput("");
    setHighlights(step.kind === "speak" && step.targetId ? [step.targetId] : []);
    setCanvasRevision(v => v + 1); setCanvasAction('none');
  }, [bookId, lessonId, progress.stepIndex, step.id]);

  function halt() {
    speakingVersion.current++; stopSpeech(); setSpeaking(false); recognition.current?.abort(); recognition.current = null;
    if (recorder.current?.state === "recording") { recorder.current.onstop = null; recorder.current.stop(); }
    recorder.current = null; streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
    if (timer.current) clearInterval(timer.current); timer.current = null; setRecording(false); setSeconds(0);
  }
  function invalidate(endLive = true) { epoch.current++; request.current?.abort(); setBusy(false); halt(); if (endLive) void live.stop(); }
  function chooseLesson(nextBook: Book, nextLesson: Lesson, fresh = false) {
    invalidate(); setImmersive(true); setPaused(false); setBookId(nextBook.id); setLessonId(nextLesson.id); setView("classroom"); setHistory([]);
    setReply(null); setSelectedIds([]); setShowChinese(false); setHelped(false); setError(""); setInput("");
    const saved = allProgress.find(p => p.bookId === nextBook.id && p.lessonId === nextLesson.id);
    setProgress(!fresh && saved ? saved : freshProgress(nextBook, nextLesson));
  }
  function say(text = activeEnglish, language = "en-US", slow = false) {
    if (paused) return;
    if (live.active) { live.speak(`${slow ? "Speak slowly. " : ""}${language === "zh-CN" ? "Explain briefly in Chinese: " : "Say this teaching prompt: "}${text}`); return; }
    halt(); const version = ++speakingVersion.current; setSpeaking(true);
    speakText(text, slow ? 0.62 : settings.rate, language, () => { if (speakingVersion.current === version) setSpeaking(false); });
  }
  function showReply(next: TeacherReply, read = true) {
    setReply(next); setHistory(old => [...old.slice(-19), { role: "teacher", text: next.english }]);
    if (next.highlightIds.length) setHighlights(next.highlightIds);
    if (read && (live.active || settings.voice) && !paused) say(next.english);
  }
  function advance() {
    if (paused || busy || (step.kind !== "listen" && !passed)) return;
    invalidate(false); setReply(null);
    if (progress.stepIndex === lesson.steps.length - 1) setProgress(p => ({ ...p, completed: true, updatedAt: new Date().toISOString() }));
    else { const next = lesson.steps[progress.stepIndex + 1]; setProgress(p => ({ ...p, stepIndex: p.stepIndex + 1, updatedAt: new Date().toISOString() })); if (live.active || settings.voice) say(next.english); }
  }
  function autoAdvance() {
    if (paused || busy || progress.completed || view !== 'classroom' || (step.kind !== 'listen' && !passed)) return false;
    advance(); return true;
  }
  function noteHelp() { setHelped(true); setProgress(p => ({ ...p, assistedStepIds: [...new Set([...(p.assistedStepIds || []), step.id])] })); }
  function mark(correct: boolean, text: string, assistance = helped || settings.subtitles || Boolean(progress.assistedStepIds?.includes(step.id))) { setProgress(p => recordAnswer(p, step.id, correct, text, assistance)); }
  function chooseVoiceProvider(provider: VoiceProviderId) {
    if (live.active || live.pending) return;
    setSettings(current => ({ ...current, voiceProvider: provider })); setError("");
  }
  function refreshVoiceProviders() {
    void api<ServiceStatus>("/api/status").then(status => {
      setConnected(status.configured); setKeyConfigured(Boolean(status.keyConfigured)); setSignedIn(Boolean(status.signedIn));
      setVoiceProviders(resolvedVoiceStatuses(status.voiceProviders, Boolean(status.liveReady)));
      setToast("服务配置已更新；选择服务后，手动开始课堂进行实测。");
    }).catch(error => setToast(error.message));
  }
  function startLive() {
    setImmersive(true);
    if (!signedIn) { setDialog("settings"); setToast("登录后可使用 AI 实时老师，演示练习仍可直接体验。"); return; }
    if (!liveReady) { setDialog("settings"); setToast(`${VOICE_PROVIDERS[selectedProvider].name}待配置，尚未实测。`); return; }
    if (paused || progress.completed) return;
    if (!settings.consent) { setDialog("settings"); setToast("先请家长同意开启实时语音，再与老师对话。"); return; }
    halt(); setError(""); live.start("classroom", liveContext);
  }
  async function executeLiveTool(call: LiveToolCall): Promise<unknown> {
    if (call.arguments.length > 8000) return { status: "rejected", reason: "Tool arguments are too large." };
    let parsed: ReturnType<typeof liveToolSchema.parse>;
    try { parsed = liveToolSchema.parse({ name: call.name, arguments: JSON.parse(call.arguments) }); }
    catch { return { status: "rejected", reason: "Unknown or malformed classroom action." }; }
    if (parsed.arguments.contextKey !== liveContext.contextKey || paused || progress.completed || view !== "classroom") return { status: "obsolete", reason: "This classroom context has changed. Do not apply or describe this action." };
    if (parsed.name === "highlight_objects") {
      const ids = parsed.arguments.objectIds;
      if (!ids.every(id => page.objects.some(o => o.id === id))) return { status: "rejected", reason: "An object does not exist on this page." };
      const drawEpoch = epoch.current;
      setHighlights(ids); if (step.kind === "select") noteHelp();
      // Confirm after React has had an opportunity to paint the actual circle overlay.
      await new Promise<void>(resolve => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(() => resolve())); else setTimeout(resolve, 0); });
      if (drawEpoch !== epoch.current) return { status: 'obsolete' };
      return { status: "confirmed", contextKey: liveContext.contextKey, highlighted: ids.map(id => page.objects.find(o => o.id === id)!.label), rendered: 'circle' };
    }
    if (parsed.name === "submit_spoken_answer") {
      if (step.kind !== "speak") return { status: "rejected", reason: "This task requires a visual selection. Wait for the child to draw; spoken words do not complete it." };
      if (passed) return { status: "confirmed", assessment: "already_correct", instruction: "Use the current material for a short follow-up; the application controls progression." };
      const text = parsed.arguments.answer;
      if (/[?？]|什么|怎么|不会|不懂|意思|help|\b(what|why|how)\b/i.test(text)) return { status: "rejected", reason: "This is a question or request for help, not a completed answer." };
      if (step.expected && matchesSpeech(text, step.expected)) {
        mark(true, text); showReply({ english: "That answer fits. Let's build on it.", chinese: "这个表达符合题意，接下来用它继续练习。", highlightIds: step.targetId ? [step.targetId] : [], assessment: "correct" }, false);
        return { status: "confirmed", assessment: "correct", instruction: "Give content-specific feedback and one meaningful follow-up. The application controls progression." };
      }
    }
    const version = epoch.current;
    const help = parsed.name === "inspect_current_page";
    const message = parsed.name === "inspect_current_page" ? parsed.arguments.question : parsed.arguments.answer;
    if (help) noteHelp();
    setBusy(true);
    try {
      const strokes = progress.strokes.filter(s => s.pageId === page.id && s.stepId === step.id).slice(-6);
      const image = await classroomSnapshot(page, strokes, highlights);
      if (version !== epoch.current) return { status: "obsolete" };
      const visionAt = performance.now();
      const result = await api<TeacherReply & { performance?: ServerPerformance }>("/api/teacher", { step, objects: page.objects, image, strokes: strokes.map(s => ({ tool: s.tool, points: s.points.filter((_, i) => i % Math.max(1, Math.ceil(s.points.length / 150)) === 0) })), message, history: history.slice(-12), selectedIds, help, age: settings.age }, AbortSignal.timeout(60000));
      const clientHttpMs = performance.now() - visionAt;
      if (version !== epoch.current) return { status: "obsolete", reason: "The task changed while inspecting the page. Discard the old result." };
      if (!help && result.assessment !== "none") mark(result.assessment === "correct", message);
      showReply(result, false);
      return { status: "confirmed", ...result, performance: { ...result.performance, clientHttpMs }, instruction: "Use these verified facts for your spoken reply, then return to the current task. Do not advance the lesson." };
    } catch { return { status: "failed", instruction: "The page check did not finish. Do not guess or claim correctness. Ask the learner to retry, or use text and circles." }; }
    finally { if (version === epoch.current) setBusy(false); }
  }
  function select(points: Point[], kind: "pen" | "circle") {
    if (paused || busy || progress.completed) return;
    const stroke: Stroke = { id: crypto.randomUUID(), points, pageId: page.id, stepId: step.id, tool: kind, color };
    setProgress(p => ({ ...p, strokes: [...p.strokes.slice(-119), stroke] }));
    setCanvasRevision(v => v + 1); setCanvasAction(points.length < 2 ? 'tap' : 'draw');
    const selection = resolveSelection(points, page.objects, kind); setSelectedIds(selection.ids);
    if (step.kind !== "select" || passed) {
      if (selection.ids.length === 1) { const o = page.objects.find(o => o.id === selection.ids[0])!; setToast(`你选中了 ${o.label}，可以问老师：“这是什么意思？”`); } return;
    }
    if (selection.status === "ambiguous") { showReply({ english: "I see more than one. Can you choose just one?", chinese: "你圈到了不止一个对象，选一个再试试吧。", highlightIds: [], assessment: "none" }); return; }
    if (selection.status === "empty") { showReply({ english: "Can you tap the picture, or draw a circle around it?", chinese: "还没有看清你的选择。点一下图片，或者在它周围画个圈吧。", highlightIds: [], assessment: "none" }); return; }
    const correct = selection.ids[0] === step.targetId; mark(correct, selection.ids.join(","));
    if (correct) showReply({ english: `You selected ${step.expected || "the right object"}. Let's describe it in English next.`, chinese: "选择正确，接下来用英语描述它。", highlightIds: selection.ids, assessment: "correct" });
    else { const attempts = (answer?.attempts || 0) + 1, o = page.objects.find(o => o.id === selection.ids[0]); if (attempts >= 2) noteHelp(); showReply({ english: `${o ? `That's ${o.label}. ` : ""}Let's look for ${step.expected} again.`, chinese: attempts >= 2 ? step.hint : "没关系，我们再找一次。仔细听老师说的是哪一个。", highlightIds: attempts >= 2 && step.targetId ? [step.targetId] : [], assessment: "retry" }); }
  }
  function undoMark() {
    const remaining = pageStrokes.slice(0, -1), last = remaining.at(-1);
    setProgress(p => ({ ...p, strokes: p.strokes.filter(s => s.id !== pageStrokes.at(-1)?.id) }));
    setSelectedIds(last ? resolveSelection(last.points, page.objects, last.tool).ids : []);
    setCanvasRevision(v => v + 1); setCanvasAction('undo');
  }
  function clearMarks() {
    setProgress(p => ({ ...p, strokes: p.strokes.filter(s => s.stepId !== step.id) })); setHighlights([]); setSelectedIds([]);
    setCanvasRevision(v => v + 1); setCanvasAction('clear');
  }
  async function send(message = input, isHelp = false) {
    const text = message.trim(); if (!text || busy || paused || progress.completed) return;
    halt(); setInput(""); setError(""); setHistory(old => [...old.slice(-19), { role: "child", text }]);
    if (isHelp) { noteHelp(); setShowChinese(true); }
    const question = /[?？]|什么|怎么|不会|不懂|意思|再说|慢|help|what|why|how|dont|don't|cannot|cant|can't/i.test(text);
    if (live.active) { if (question) noteHelp(); if (live.sendTyped(text)) return; }
    if (step.kind === "speak" && !passed && !isHelp && !question && step.expected && matchesSpeech(text, step.expected)) { mark(true, text); showReply({ english: "That answer fits. Try using it in your own sentence.", chinese: "表达符合题意。试着换一个自己的句子；这不是发音评分。", highlightIds: step.targetId ? [step.targetId] : [], assessment: "correct" }); return; }
    if (!canUseAI) {
      const o = page.objects.find(o => o.id === selectedIds[0]);
      if (isHelp || question) { noteHelp(); setShowChinese(true); showReply({ english: o ? `This is ${o.label}. ${step.english}` : step.hint, chinese: o ? `你选中的是「${o.chinese}」。${step.chinese}` : step.chinese, highlightIds: step.targetId ? [step.targetId] : [], assessment: "none" }, false); if (settings.voice) say(o ? `这是${o.chinese}。${step.chinese}` : step.chinese, "zh-CN"); }
      else if (step.kind === "speak" && !passed) { mark(false, text); showReply({ english: `Let's try again. ${step.hint}`, chinese: "演示老师只能核对示范表达。你可以再说一次，或用文字回答。", highlightIds: step.targetId ? [step.targetId] : [], assessment: "retry" }); }
      else showReply({ english: step.english, chinese: "演示课堂会按预设任务带你练习。连接 AI 后，就能围绕教材自由提问了。", highlightIds: [], assessment: "none" });
      return;
    }
    if (!settings.consent) { setDialog("settings"); setToast("请先由家长同意开启 AI 功能，再发送课堂对话。"); return; }
    if (question) noteHelp();
    const version = epoch.current; request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const strokes = progress.strokes.filter(s => s.pageId === page.id && s.stepId === step.id).slice(-6);
      const image = await classroomSnapshot(page, strokes, highlights);
      if (version !== epoch.current) return;
      const response = await api<TeacherReply>("/api/teacher", { step, objects: page.objects, image, strokes: strokes.map(s => ({ tool: s.tool, points: s.points.filter((_, i) => i % Math.max(1, Math.ceil(s.points.length / 150)) === 0) })), message: text, history: history.slice(-12), selectedIds, help: isHelp || question, age: settings.age }, AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]));
      if (version !== epoch.current) return;
      if (response.assessment === "correct" && step.kind === "speak" && !passed) mark(true, text);
      if (response.assessment === "retry" && step.kind === "speak" && !passed) mark(false, text);
      showReply(response);
    } catch (e) { if (version === epoch.current && !(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : "老师暂时没有连接，请再试一次。"); }
    finally { if (version === epoch.current) setBusy(false); }
  }
  function help() { void send("我没有听懂，请用中文解释一下，然后带我回到这道题。", true); }
  async function toggleRecording() {
    if (recording) { if (recorder.current?.state === "recording") recorder.current.stop(); else recognition.current?.stop(); return; }
    if (paused || busy || progress.completed) return;
    if (!settings.consent) { setDialog("settings"); setToast("先请家长同意开启语音功能。文字和圈画可直接使用。"); return; }
    halt(); setError(""); const version = epoch.current;
    if (!canUseAI) {
      const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
      const Constructor = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (!Constructor) { setError("这个浏览器没有设备语音识别。可以用文字回答，或连接 AI 服务后使用录音。"); return; }
      const r = new Constructor(); recognition.current = r; r.lang = settings.language; r.continuous = false; r.interimResults = false;
      r.onresult = e => { if (version === epoch.current) { const text = e.results[0]?.[0]?.transcript; if (text) void send(text); } };
      r.onerror = e => { if (version === epoch.current && e.error !== "aborted") setError(e.error === "not-allowed" ? "麦克风权限未开启。请在浏览器中允许，或改用文字回答。" : "这次没有听清，可以再试一次，或用文字回答。"); };
      r.onend = () => { if (version === epoch.current) setRecording(false); };
      try { r.start(); setRecording(true); } catch { setError("无法开始语音识别，请使用文字回答。"); } return;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持录音，请使用文字回答。");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (version !== epoch.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t));
      const media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks: BlobPart[] = []; recorder.current = media;
      media.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      media.onstop = async () => {
        stream.getTracks().forEach(t => t.stop()); streamRef.current = null; if (timer.current) clearInterval(timer.current); timer.current = null; setRecording(false); setSeconds(0);
        if (version !== epoch.current) return; setBusy(true);
        try {
          const form = new FormData(); form.append("audio", new Blob(chunks, { type: media.mimeType }), media.mimeType.includes("mp4") ? "answer.mp4" : "answer.webm");
          const transcript = await api<{ text: string }>("/api/transcribe", form, AbortSignal.timeout(45000));
          if (version !== epoch.current) return;
          if (!transcript.text.trim()) setError("没有听到清楚的回答，请再试一次。"); else { setInput(transcript.text); setToast("识别完成，请检查文字后点击发送。"); }
        } catch (e) { if (version === epoch.current) setError(e instanceof Error ? e.message : "录音未能识别，请再试一次。"); }
        finally { if (version === epoch.current) setBusy(false); }
      };
      media.start(); setRecording(true); setSeconds(0); let elapsed = 0;
      timer.current = setInterval(() => { elapsed++; setSeconds(elapsed); if (elapsed >= 30 && media.state === "recording") media.stop(); }, 1000);
    } catch (e) { if (version === epoch.current) { halt(); setError(e instanceof Error && e.name === "NotAllowedError" ? "麦克风权限未开启。请在浏览器中允许，或使用文字回答。" : e instanceof Error ? e.message : "无法打开麦克风。"); } }
  }
  function pause() { if (!paused) { invalidate(); setPaused(true); } else setPaused(false); }
  function exportProgress() {
    const data = { exportedAt: new Date().toISOString(), childName: settings.childName, records: allProgress.map(p => ({ ...p, strokes: undefined, bookTitle: books.find(b => b.id === p.bookId)?.title, lessonTitle: books.find(b => b.id === p.bookId)?.lessons.find(l => l.id === p.lessonId)?.title })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), link = document.createElement("a"); link.href = url; link.download = "littleleaf-learning-records.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function removeBook() {
    invalidate();
    try { await storage.deleteBook(deleteId); await Promise.all(allProgress.filter(p => p.bookId === deleteId).map(p => storage.deleteProgress(`${p.bookId}:${p.lessonId}`))); setAllProgress(old => old.filter(p => p.bookId !== deleteId)); setBooks(old => old.filter(b => b.id !== deleteId)); if (bookId === deleteId) chooseLesson(DEMO, DEMO.lessons[0]); setDialog(null); setToast("教材和对应学习记录已从此设备删除。"); }
    catch (e) { setToast(e instanceof Error ? e.message : "删除失败，请重试。"); }
  }
  async function clearData() {
    invalidate(); await live.stop(); clearPerformanceReports();
    try { for (const b of books.filter(b => b.source !== "demo")) await storage.deleteBook(b.id); for (const p of allProgress) await storage.deleteProgress(`${p.bookId}:${p.lessonId}`); await storage.saveSettings(defaultSettings); setBooks([DEMO]); setAllProgress([]); setSettings(defaultSettings); chooseLesson(DEMO, DEMO.lessons[0], true); setDialog(null); setToast("本机学习数据已清除，演示教材仍可体验。"); }
    catch (e) { setToast(e instanceof Error ? e.message : "清除失败，请重试。"); }
  }

  return <div className={`app-shell ${immersive && view === "classroom" ? "immersive-classroom" : ""}`}>
    <header className="site-header"><button className="brand" onClick={() => setView("classroom")} aria-label="小叶英语，返回课堂"><span className="brand-symbol"><LeafIcon size={25} strokeWidth={1.8} /></span><span>littleleaf<span className="brand-cn">小叶英语</span></span></button><nav aria-label="主导航">{([{ id: "classroom", label: "我的课堂", icon: BookOpen }, { id: "library", label: "教材书架", icon: Headphones }, { id: "journey", label: "学习足迹", icon: Sprout }] as const).map(item => <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => { if (item.id !== "classroom") { invalidate(); setPaused(false); } setView(item.id); }}><item.icon size={17} />{item.label}</button>)}</nav><div className="header-right"><span className={`connection-pill ${connected || anyVoiceReady ? "online" : ""}`}><i />{connected || anyVoiceReady ? signedIn ? "AI 已连接" : "登录可用 AI" : "演示课堂"}</span><button className="parent-button" onClick={() => { halt(); setDialog("settings"); }}><Settings2 size={16} /><span>家长设置</span></button><span className="child-avatar" title={settings.childName}>✿</span></div></header>
    {immersive && view === "classroom" && <header className="room-header"><button className="room-back" onClick={() => { invalidate(); setImmersive(false); setView('library'); }}><ArrowRight size={17} />返回教材</button><div className="room-title"><span>和小叶一起 · 英语时光</span><strong>{book.title}</strong></div><div className="room-header-actions"><span className={`room-connection ${live.active ? 'connected' : ''}`}><i />{live.active ? '实时互动中' : '准备开始'}</span><button className="icon-button" aria-label="沉浸课堂设置" onClick={() => { halt(); setDialog('settings'); }}><Settings2 size={19} /></button></div></header>}
    <NetworkNotice active={live.active} sample={live.performance?.latest || null} />
    {(keyConfigured || anyVoiceReady) && !signedIn && <div className="site-login-notice"><span>你可以直接浏览和体验演示练习；登录后可使用 AI 备课与实时老师。</span><a href="/signin-with-chatgpt?return_to=%2F" target="_top">登录后使用 AI 老师 <ArrowRight size={13} /></a></div>}
    <main className="main-content">
      {view === "classroom" && <>
        <div className="welcome-row"><div><div className="eyebrow"><span className="tiny-sun">✳</span> A LITTLE ENGLISH, A LITTLE GROWTH</div><h1>每一次开口，<span>都在长大。</span></h1><p>你好，{settings.childName}！今天也和小叶老师一起，发现英语里的小美好。</p></div><div className="classroom-entry"><button className="button primary" onClick={() => setImmersive(true)}><Headphones size={17} />进入沉浸课堂</button><button className="button secondary upload-top" onClick={() => { halt(); setDialog("upload"); }}><Plus size={17} /> 上传我的教材</button></div></div>
        <div className="classroom-grid">
          <aside className="lesson-sidebar"><div className="book-cover"><div className="cover-top"><span>LITTLE EXPLORERS</span><BookOpen size={17} /></div><div className="cover-illustration"><Leaf size={76} /><span className="cover-flower">✳</span><span className="cover-star">✦</span></div><h2>{book.source === "demo" ? "小小探索家" : book.title}</h2><p>{book.source === "demo" ? "世界很大，我们慢慢探索。" : `${book.pages.length} 页专属教材 · ${book.lessons.length} 节课`}</p><span className="cover-level">{book.source === "demo" ? "启蒙英语 · 演示教材" : book.source === "ai" ? "我的教材 · AI 备课" : "我的教材 · 手动备课"}</span></div><div className="sidebar-heading"><h3>我的课程</h3><span>{book.lessons.filter(l => allProgress.some(p => p.bookId === book.id && p.lessonId === l.id && p.completed)).length}/{book.lessons.length}</span></div><div className="lesson-list">{book.lessons.map((l, i) => { const saved = allProgress.find(p => p.bookId === book.id && p.lessonId === l.id), active = l.id === lesson.id; return <button key={l.id} className={`lesson-item ${active ? "selected" : ""}`} onClick={() => chooseLesson(book, l)}><span className={`lesson-index ${saved?.completed ? "finished" : ""}`}>{saved?.completed ? <Check size={16} /> : String(i + 1).padStart(2, "0")}</span><span className="lesson-item-copy"><strong>{l.title}</strong><small>{l.duration} 分钟 · {l.words.length} 个词语</small></span>{active && <span className="playing-bars"><i /><i /><i /></span>}</button>; })}</div><div className="sidebar-note"><Flower2 size={28} strokeWidth={1.3} /><div><strong>一点点，也很了不起。</strong><p>听一听，说一说，按自己的节奏来。</p></div></div><button className="text-button change-book" onClick={() => { invalidate(); setView("library"); }}><BookOpen size={15} /> 换一本教材 <ArrowRight size={14} /></button></aside>
          <section className="lesson-workspace" aria-label="教材与标注"><div className="workspace-top"><div className="lesson-breadcrumb"><span>LESSON {String(book.lessons.findIndex(l => l.id === lesson.id) + 1).padStart(2, "0")}</span><h2>{lesson.title}</h2></div><div className="workspace-controls"><span><Clock3 size={14} /> 约 {lesson.duration} 分钟</span><button className="icon-button" aria-label="重新开始这节课" title="重新开始" onClick={() => setDialog("restart")}><RotateCcw size={17} /></button></div></div><div className="lesson-progress"><span style={{ width: `${progress.completed ? 100 : progress.stepIndex / lesson.steps.length * 100}%` }} /></div>
            {progress.completed ? <div className="completion"><div className="completion-stars">✦ <Star fill="#d9b75d" size={49} /> ✦</div><span className="eyebrow">LOOK HOW FAR YOU’VE GROWN</span><h2>今天的你，又长大了一点！</h2><p>你完成了「{lesson.title}」，给认真探索的自己一朵小花。</p><div className="completion-stats"><div><strong>{stats.answered}</strong><span>完成的练习</span></div><div><strong>{stats.independent}</strong><span>首次独立答对</span></div><div><strong>{lesson.words.length}</strong><span>练习的词语</span></div></div><div className="word-bubbles">{lesson.words.map(w => <span key={w}>{w}</span>)}</div><p className="muted small-text">记录反映本次练习表现，不代表长期掌握，也不包含发音评分。</p><button className="button primary" onClick={() => { const next = book.lessons[book.lessons.findIndex(l => l.id === lesson.id) + 1]; if (next) chooseLesson(book, next); else setView("journey"); }}>{book.lessons.findIndex(l => l.id === lesson.id) < book.lessons.length - 1 ? "探索下一课" : "看看我的学习足迹"}<ArrowRight size={17} /></button><button className="text-button" onClick={() => chooseLesson(book, lesson, true)}>我想再练一次</button></div> : <>
              <div className="canvas-mat"><div className="page-label"><span><i /> {step.kind === "listen" ? "一起听一听" : step.kind === "select" ? "动手找一找" : "勇敢说一说"}</span><span>第 {progress.stepIndex + 1} / {lesson.steps.length} 步</span></div><MaterialCanvas key={`${book.id}-${page.id}-${step.id}`} page={page} strokes={progress.strokes.filter(s => s.stepId === step.id)} highlights={highlights} tool={tool} color={color} onStroke={select} onActivity={live.learnerActivity} disabled={paused || busy} /><div className="canvas-caption"><span><Pencil size={13} />{step.kind === "select" ? "直接点选，或者把答案圈出来" : "圈住一个地方，也可以向老师提问"}</span><span>教材第 {book.pages.findIndex(p => p.id === page.id) + 1} 页</span></div>{paused && <div className="paused-cover"><Pause size={32} /><strong>休息一下，课堂已暂停</strong><button className="button primary" onClick={pause}>继续学习 <Play size={16} /></button></div>}</div>
              <div className="drawing-toolbar"><div className="tool-group" role="group" aria-label="画笔工具"><button className={tool === "pen" ? "tool active" : "tool"} onClick={() => setTool("pen")} aria-label="自由画笔" aria-pressed={tool === "pen"}><Pencil size={17} /><span>画笔</span></button><button className={tool === "circle" ? "tool active" : "tool"} onClick={() => setTool("circle")} aria-label="画圈工具" aria-pressed={tool === "circle"}><Circle size={18} /><span>圈选</span></button><span className="tool-divider" />{["#de8169", "#718d65", "#769db4"].map(c => <button key={c} className={`color-swatch ${color === c ? "active" : ""}`} style={{ "--swatch": c } as React.CSSProperties} onClick={() => setColor(c)} aria-label={`${c === "#de8169" ? "珊瑚" : c === "#718d65" ? "森林绿" : "天空蓝"}画笔`} aria-pressed={color === c} />)}</div><div className="tool-group"><button className="tool" onClick={undoMark} disabled={!progress.strokes.some(s => s.stepId === step.id) || paused || busy} aria-label="撤销上一笔"><Undo2 size={17} /><span>撤销</span></button><button className="tool" onClick={clearMarks} aria-label="清除本题标注" disabled={paused || busy}><Trash2 size={16} /></button></div></div>
              <details className="accessible-answers"><summary>也可以用按钮选择教材对象</summary><div>{page.objects.map(o => <button className="button secondary small-button" key={o.id} disabled={paused || busy} onClick={() => select([{ x: o.box.x + o.box.w / 2, y: o.box.y + o.box.h / 2 }], "pen")}>{o.label}</button>)}</div></details>
            </>}
          </section>
          <aside className="teacher-panel" aria-label="小叶老师"><div className="teacher-heading"><Leaf size={46} /><div><h2>小叶老师 <span>Leaf</span></h2><p><i /> {paused ? "等你准备好" : live.active ? "实时对话中，可以直接说话" : recording ? "正在听你说话" : busy ? "正在认真思考" : speaking ? "正在说话" : "陪你一起探索"}</p></div><button className="icon-button" aria-label="查看课堂对话" onClick={() => setDialog("history")}><MoreHorizontal size={21} /></button></div>{immersive ? <TeacherAvatar level={live.audioLevel} connected={live.active} speaking={speaking} paused={paused} /> : <div className="teacher-intro"><span className="teacher-wave">✦</span><p>A little try.<br />A lovely start.</p><span>小小尝试，就是美好的开始。</span></div>}
            <div className={`speech-card ${passed ? "success" : ""}`} aria-live="polite"><div className="speech-card-label">{passed ? <><CheckCheck size={14} /> 做得好，继续保持</> : <><MessageCircle size={14} /> {progress.completed ? "今天的课堂小结" : busy ? "老师正在思考…" : "小叶老师说"}</>}<button className="icon-button small" aria-label="朗读老师的话" onClick={() => say(progress.completed ? "You did a lovely job today! See you next time." : activeEnglish)} disabled={paused || busy}><Volume2 size={16} /></button></div><p className="english-prompt">{progress.completed ? "You did a lovely job today! See you next time." : live.active && live.outputText ? live.outputText.slice(-360) : activeEnglish}</p>{(showChinese || settings.subtitles || progress.completed) && <p className="chinese-prompt">{progress.completed ? "今天认真学习的你，很了不起。下次再一起探索吧！" : activeChinese}</p>}{!progress.completed && <div className="speech-actions"><button onClick={() => { noteHelp(); say(activeEnglish, "en-US", true); }} disabled={paused || busy}><Headphones size={13} /> 慢一点</button><button onClick={() => { setShowChinese(v => !v); noteHelp(); }} aria-pressed={showChinese}>{showChinese ? "收起中文" : "看看中文"}</button></div>}</div>
            <VoiceProviderPicker value={selectedProvider} statuses={voiceProviders} locked={live.active || live.pending} onChange={chooseVoiceProvider} onRefresh={refreshVoiceProviders} /><PerformancePanel provider={selectedProvider} summary={live.performance} active={live.active} strategy={live.strategy} onStrategy={live.setStrategy} onMark={live.markStutter} getReport={live.getPerformanceReport} />{!progress.completed && <><LiveVoicePanel state={live.state} muted={live.muted} inputText={live.inputText} outputText={live.outputText} usage={live.usageSeconds} onStart={startLive} onStop={() => { void live.stop(); }} onMute={live.toggleMute} onPlay={live.play} onRefocus={live.refocus} activity={live.activity} pageSync={live.pageSync} coaching={live.coaching} onCoaching={live.toggleCoaching} enabled={liveReady && signedIn} blocked={paused || busy || !ready} /><div className="teacher-help"><button onClick={help} disabled={paused || busy}><CircleHelp size={16} /> 老师，我没听懂 <span>中 / EN</span></button></div>{error && <div className="error-notice compact" role="alert">{error}<button className="icon-button small" onClick={() => setError("")} aria-label="关闭错误提示"><X size={14} /></button></div>}<div className="response-area"><span className="response-label">{live.active ? "可以直接说话，也可以打字告诉老师" : recording ? "正在听你说，点一下结束" : busy ? "稍等一下…" : step.kind === "select" && !passed ? "你的画笔，也是你的回答" : "轮到你啦，勇敢试一试"}</span>{!live.active && <><button className={`microphone-button ${recording ? "recording" : ""}`} onClick={() => void toggleRecording()} disabled={paused || busy || live.pending} aria-label={recording ? "结束录音" : "开始语音回答"}>{busy ? <LoaderCircle size={26} className="spin" /> : recording ? <AudioLines size={28} /> : <Mic size={28} strokeWidth={1.6} />}</button><span className="mic-caption">{recording ? `点击结束${connected ? ` · ${seconds}s / 30s` : ""}` : connected ? "单句录音回答（备用）" : "点击麦克风说话"}</span><button className="language-toggle" onClick={() => setSettings(s => ({ ...s, language: s.language === "en-US" ? "zh-CN" : "en-US" }))} disabled={recording}>{settings.language === "en-US" ? "英语识别 EN" : "中文识别 中"}<ChevronRight size={12} /></button></>}<form className="chat-input" onSubmit={e => { e.preventDefault(); void send(); }}><input aria-label="文字回答或向老师提问" placeholder="也可以打字告诉老师…" value={input} maxLength={1000} onChange={e => setInput(e.target.value)} disabled={paused || busy || recording} /><button type="submit" aria-label="发送回答" disabled={!input.trim() || paused || busy || recording}><Send size={17} /></button></form></div><button className="button primary next-button" onClick={advance} disabled={paused || busy || (step.kind !== "listen" && !passed)}>{step.kind === "listen" ? "我准备好了" : passed ? progress.stepIndex === lesson.steps.length - 1 ? "完成这节课" : "继续探索" : step.kind === "select" ? "先在教材里找一找" : "先来试着说一说"}{step.kind === "listen" || passed ? <ArrowRight size={17} /> : <span className="next-dot" />}</button></>}
            <div className="teacher-bottom"><button onClick={() => { if (settings.voice) halt(); setSettings(s => ({ ...s, voice: !s.voice })); }} disabled={live.active} aria-label={settings.voice ? "关闭自动朗读" : "开启自动朗读"}>{settings.voice ? <Volume2 size={15} /> : <VolumeX size={15} />}<span>{settings.voice ? "自动朗读" : "朗读已关"}</span></button><button onClick={pause} disabled={progress.completed}>{paused ? <Play size={14} /> : <Pause size={14} />}<span>{paused ? "继续课堂" : "休息一下"}</span></button></div><div className="teacher-mode-note"><ShieldCheck size={12} />{book.source === "demo" ? "演示教材 · 可自由圈画与练习" : connected ? "教材保存在当前浏览器中" : "预设教学 · 连接 AI 后可自由问答"}</div>
          </aside>
        </div><div className="bottom-note"><Sprout size={16} /><p>不着急，不比较。让英语像一颗小种子，慢慢发芽。</p><span>{stats.answered}/{childTasks} 个练习已完成</span></div>
      </>}
      {view === "library" && <><div className="welcome-row"><div><div className="eyebrow">MY BOOKS, MY LITTLE WORLD</div><h1>每一本教材，<span>都有新发现。</span></h1><p>带上学校的课本、喜欢的绘本，让小叶老师陪你一起读。</p></div><button className="button primary" onClick={() => setDialog("upload")}><Plus size={17} /> 上传教材</button></div><div className="library-notice"><ShieldCheck size={20} /><p>教材与学习进度保存在这台设备的当前浏览器中。AI 备课会发送所选页面；清理浏览器数据会删除本地教材。</p></div><div className="books-grid">{books.map((b, i) => <article className="book-card" key={b.id}><button className={`book-art art-${i % 3}`} onClick={() => chooseLesson(b, b.lessons[0])}><img src={b.pages[0].image} alt={`${b.title}教材封面`} /><span>{b.source === "demo" ? "体验教材" : b.source === "ai" ? "AI 备课" : "手动备课"}</span></button><div className="book-card-info"><h2>{b.title}</h2><p>{b.pages.length} 页教材 · {b.lessons.length} 节课程</p><div><button className="text-button" onClick={() => chooseLesson(b, b.lessons[0])}>打开课堂 <ArrowRight size={16} /></button>{b.source !== "demo" && <button className="icon-button" aria-label={`删除教材 ${b.title}`} onClick={() => { setDeleteId(b.id); setDialog("delete"); }}><Trash2 size={16} /></button>}</div></div></article>)}<button className="add-book" onClick={() => setDialog("upload")}><span><Plus size={30} strokeWidth={1.3} /></span><strong>下一场冒险，从这里开始</strong><p>上传 PDF 或教材照片</p></button></div></>}
      {view === "journey" && <><div className="welcome-row"><div><div className="eyebrow">EVERY LITTLE STEP COUNTS</div><h1>小小的脚印，<span>大大的成长。</span></h1><p>看见每一次认真倾听、勇敢开口和动手尝试。</p></div><button className="button secondary" onClick={exportProgress}><ArrowDownToLine size={17} /> 导出学习记录</button></div><div className="journey-stats"><div><span className="stat-icon"><BookOpen size={24} /></span><strong>{allProgress.filter(p => p.completed).length}</strong><p>完成的课程</p></div><div><span className="stat-icon coral"><MessageCircle size={24} /></span><strong>{allProgress.reduce((n, p) => n + p.answers.filter(a => a.correct).length, 0)}</strong><p>完成的互动练习</p></div><div><span className="stat-icon gold"><Star size={24} /></span><strong>{allProgress.reduce((n, p) => n + lessonStats(p).independent, 0)}</strong><p>首次独立答对</p></div></div><div className="journey-list"><h2><Sprout size={20} /> 我的学习记录</h2>{allProgress.some(p => p.answers.length || p.completed || p.stepIndex > 0) ? allProgress.filter(p => p.answers.length || p.completed || p.stepIndex > 0).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(p => { const b = books.find(b => b.id === p.bookId), l = b?.lessons.find(l => l.id === p.lessonId); return <div className="journey-row" key={`${p.bookId}:${p.lessonId}`}><span className={`journey-status ${p.completed ? "complete" : ""}`}>{p.completed ? <Check size={20} /> : <Pencil size={20} />}</span><div><strong>{l?.title || "已移除的课程"}</strong><p>{b?.title} · {new Date(p.updatedAt).toLocaleDateString("zh-CN")} · {p.answers.filter(a => a.correct).length} 个练习完成</p></div><span className="record-state">{p.completed ? "已完成" : "学习中"}</span>{b && l && <button className="button secondary small-button" onClick={() => chooseLesson(b, l)}>{p.completed ? "查看" : "继续"}<ArrowRight size={14} /></button>}</div>; }) : <div className="empty-state"><Leaf size={76} /><h3>第一片小叶子，等你来点亮</h3><p>完成一次课堂互动，就会在这里留下你的足迹。</p><button className="button primary" onClick={() => setView("classroom")}>去上第一节课 <ArrowRight size={16} /></button></div>}<p className="journey-explanation">“首次独立答对”指本次记录中第一次作答正确，且没有使用已记录的提示。这些课堂记录不代表标准化测评结果。</p></div></>}
    </main>
    <footer className="site-footer"><span>littleleaf <LeafIcon size={12} /> 小叶英语</span><span>每一次开口，都值得被听见。</span><span>为好奇心而生</span></footer>
    {dialog === "upload" && <UploadDialog connected={canUseAI} age={settings.age} consent={settings.consent} onClose={() => setDialog(null)} onSave={async b => { await storage.saveBook(b); setBooks(old => [...old, b]); chooseLesson(b, b.lessons[0]); }} />}
    {dialog === "settings" && <Modal title="把课堂调成喜欢的样子" subtitle="家长设置 · 偏好保存在当前浏览器，服务密钥由服务器保管" onClose={() => setDialog(null)}><div className="settings-grid"><label className="field">孩子的课堂昵称<input value={settings.childName} maxLength={20} onChange={e => setSettings(s => ({ ...s, childName: e.target.value }))} /></label><label className="field">年龄<select value={settings.age} onChange={e => setSettings(s => ({ ...s, age: Number(e.target.value) }))}>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i + 4}>{i + 4} 岁</option>)}</select></label></div><label className="setting-toggle"><span><strong>自动朗读老师的话</strong><small>随时点击喇叭可以重听，声音由设备合成。</small></span><input type="checkbox" checked={settings.voice} onChange={e => setSettings(s => ({ ...s, voice: e.target.checked }))} /></label><label className="setting-toggle"><span><strong>默认显示中文解释</strong><small>需要更多英语沉浸时，可以关闭。</small></span><input type="checkbox" checked={settings.subtitles} onChange={e => setSettings(s => ({ ...s, subtitles: e.target.checked }))} /></label><label className="field range-field">老师的语速 <span>{settings.rate <= 0.7 ? "慢慢说" : settings.rate < 1 ? "轻松听" : "自然说"}</span><input type="range" min="0.6" max="1.1" step="0.05" value={settings.rate} onChange={e => setSettings(s => ({ ...s, rate: Number(e.target.value) }))} /></label><VoiceProviderPicker value={selectedProvider} statuses={voiceProviders} locked={live.active || live.pending} onChange={chooseVoiceProvider} onRefresh={refreshVoiceProviders} /><div className="connection-settings"><div><span className={`status-dot ${connected ? "online" : ""}`} /><strong>{connected ? "教材备课与备用问答已配置" : "教材备课与备用问答尚未配置"}</strong><button className="text-button" onClick={refreshVoiceProviders}>重新检查</button></div>{(keyConfigured || anyVoiceReady) && !signedIn && <a className="sign-in-link" href="/signin-with-chatgpt?return_to=%2F" target="_top">登录后使用 AI 老师 <ArrowRight size={13} /></a>}<p>{connected ? "AI 备课发送选中教材；问答发送当前页、圈画与对话；实时课堂连接期间持续传输麦克风声音，结束后停止采集。不保存录音。" : "演示课堂与手动备课已可使用。真实 AI 需要服务端配置 OPENAI_API_KEY，请勿把密钥填写在孩子的浏览器中。"}</p></div><label className="checkbox-line consent-box"><input type="checkbox" checked={settings.consent} onChange={e => { if (!e.target.checked) { halt(); void live.stop(); } setSettings(s => ({ ...s, consent: e.target.checked })); }} /><span>我是家长，同意开启语音功能，并在主动使用 AI 时发送相关教材、课堂对话或录音；实时课堂连接期间，当前所选语音服务会收到声音和教材摘要。当前选择：{VOICE_PROVIDERS[selectedProvider].name}。未连接 AI 时，设备语音识别可能由浏览器服务商处理。</span></label><p className="voice-probe-scope">下方连接测试仅验证 GPT-Live，不受所选语音服务影响。国产语音请在配置后手动开始课堂采集时延。</p><LiveConnectionProbe available={keyConfigured} signedIn={signedIn} /><div className="settings-footer"><button className="text-button danger" onClick={() => setDialog("clear")}><Trash2 size={15} /> 清除本机学习数据</button><button className="button primary" onClick={() => { if (!settings.childName.trim()) setSettings(s => ({ ...s, childName: defaultSettings.childName })); setDialog(null); }}>完成设置 <Check size={16} /></button></div></Modal>}
    {dialog === "history" && <Modal title="课堂里的小对话" subtitle="仅显示本次打开课堂后的最近对话；切换课程后清空。" onClose={() => setDialog(null)}><div className="chat-history"><div className="chat-bubble teacher">{step.english}</div>{history.map((m, i) => <div key={i} className={`chat-bubble ${m.role}`}>{m.text}</div>)}{!history.length && <p className="muted">可以用中文或英文向老师提问，也可以先圈住教材上的一个地方。</p>}</div></Modal>}
    {dialog === "restart" && <Modal title="再来一次小小冒险？" subtitle="这节课的进度、笔画和作答记录将重新开始，其他课程不受影响。" onClose={() => setDialog(null)}><div className="modal-footer"><button className="button secondary" onClick={() => setDialog(null)}>保留当前进度</button><button className="button primary" onClick={() => { chooseLesson(book, lesson, true); setDialog(null); }}>重新开始 <RotateCcw size={16} /></button></div></Modal>}
    {dialog === "delete" && <Modal title="删除这本教材？" subtitle="教材页面、课程和对应学习记录会从此浏览器删除，此操作无法撤销。" onClose={() => setDialog(null)}><div className="modal-footer"><button className="button secondary" onClick={() => setDialog(null)}>保留教材</button><button className="button destructive" onClick={() => void removeBook()}>删除教材 <Trash2 size={16} /></button></div></Modal>}
    {dialog === "clear" && <Modal title="清除这台设备的学习数据？" subtitle="上传的教材、学习记录和设置会被删除。可以先到学习足迹导出记录。" onClose={() => setDialog(null)}><div className="modal-footer"><button className="button secondary" onClick={() => setDialog("settings")}>保留数据</button><button className="button destructive" onClick={() => void clearData()}>确认清除 <Trash2 size={16} /></button></div></Modal>}
    {toast && <div className="toast" role="status"><LeafIcon size={17} /><span>{toast}</span><button aria-label="关闭通知" onClick={() => setToast("")}><X size={15} /></button></div>}
    {!ready && <div className="loading-indicator" role="status"><LoaderCircle size={13} className="spin" /> 正在打开小课堂…</div>}
  </div>;
}
