"use client";
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, FileUp, LoaderCircle, Plus, ScanLine, Sparkles, Trash2 } from "lucide-react";
import { Modal } from "./modal";
import { MaterialCanvas } from "./material-canvas";
import type { Book, BookPage, Box } from "@/lib/types";
import { makeManualBook, readMaterials } from "@/lib/upload";
import { api } from "@/lib/browser-speech";
import type { z } from "zod";
import type { analysisSchema } from "@/lib/validation";

export function UploadDialog({ connected, age, consent, onSave, onClose }: { connected: boolean; age: number; consent: boolean; onSave: (book: Book) => Promise<void>; onClose: () => void }) {
  const [pages, setPages] = useState<BookPage[]>([]), [index, setIndex] = useState(0);
  const [title, setTitle] = useState("我的英语教材"), [stage, setStage] = useState<"upload" | "preview" | "manual" | "result">("upload");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [result, setResult] = useState<Book | null>(null);
  const [box, setBox] = useState<Box | null>(null), [english, setEnglish] = useState(""), [chinese, setChinese] = useState("");
  const [agreed, setAgreed] = useState(consent);
  const fileInput = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null), canceled = useRef(false);
  function close() { canceled.current = true; controller.current?.abort(); onClose(); }
  async function read(files: FileList | File[] | null) {
    if (!files?.length || busy) return;
    setError(""); setBusy("正在读取教材…");
    try {
      const frames = await readMaterials(Array.from(files), setBusy);
      if (canceled.current) return;
      setPages(frames); setTitle(files[0].name.replace(/\.[^.]+$/, "").slice(0, 100)); setIndex(0); setStage("preview");
    } catch (e) { setError(e instanceof Error ? e.message : "教材读取失败，请使用清晰的 PDF 或图片。"); }
    finally { setBusy(""); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function analyze() {
    if (!agreed) { setError("请先确认由家长同意，将所选教材发送给 AI 服务进行备课。"); return; }
    setError(""); setBusy("AI 正在认真备课，通常需要几十秒…");
    controller.current = new AbortController();
    try {
      const analyzed = await api<z.infer<typeof analysisSchema>>("/api/analyze", { pages, age }, AbortSignal.any([controller.current.signal, AbortSignal.timeout(120000)]));
      if (canceled.current) return;
      const book: Book = { id: crypto.randomUUID(), title: title.trim() || analyzed.title, source: "ai", createdAt: new Date().toISOString(), pages: pages.map(p => ({ ...p, objects: analyzed.pages.find(a => a.id === p.id)?.objects || [] })), lessons: analyzed.lessons };
      setResult(book); setPages(book.pages); setStage("result");
    } catch (e) { if (!canceled.current) setError(e instanceof Error && e.name === "TimeoutError" ? "备课超时了，请减少页数后重试。" : e instanceof Error ? e.message : "AI 备课失败，请重试。"); }
    finally { setBusy(""); }
  }
  function addObject() {
    if (pages[index].objects.length >= 12) { setError("每页最多标注 12 个对象，适合拆成一节短课。"); return; }
    if (!box || !english.trim() || !chinese.trim()) { setError("先在页面拖动框选，再填写中英文名称。"); return; }
    const object = { id: `object-${crypto.randomUUID()}`, label: english.trim().slice(0, 100), chinese: chinese.trim().slice(0, 100), box };
    setPages(old => old.map((p, i) => i === index ? { ...p, objects: [...p.objects, object] } : p));
    setBox(null); setEnglish(""); setChinese(""); setError("");
  }
  async function save(book: Book) {
    setBusy("正在保存到这台设备…"); setError("");
    try { await onSave(book); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试。"); } finally { setBusy(""); }
  }
  return <Modal title={stage === "result" ? "你的课程，准备好了" : "带上教材，开始小小冒险"} subtitle="每一本熟悉的教材，都可以变成一堂有回应的英语课。" onClose={close} wide>
    <div className="upload-steps"><span className="active"><span>1</span> 上传教材</span><i /><span className={stage !== "upload" ? "active" : ""}><span>2</span> 理解与备课</span><i /><span className={stage === "result" ? "active" : ""}><span>3</span> 开始学习</span></div>
    {error && <div className="error-notice" role="alert">{error}</div>}
    {stage === "upload" && <><button className="drop-zone" onClick={() => fileInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void read(e.dataTransfer.files); }} disabled={!!busy}><span className="upload-icon"><FileUp size={32} strokeWidth={1.4} /></span><strong>把教材拖到这里，或者点击上传</strong><span>支持 PDF、JPG、PNG、WebP · 每次最多 12 页 · 单文件 25 MB</span><span className="button primary">选择教材 <Plus size={16} /></span></button><p className="privacy-note">教材先在设备上预览。只有选择 AI 备课后，所选页面才会发送给 AI 服务。</p></>}
    <input ref={fileInput} type="file" className="visually-hidden" accept=".pdf,image/jpeg,image/png,image/webp" multiple onChange={e => void read(e.target.files)} aria-label="选择教材文件" />
    {(stage === "preview" || stage === "manual") && <>
      <label className="field">教材名称<input value={title} onChange={e => setTitle(e.target.value)} maxLength={100} /></label>
      <div className="material-editor"><div className="editor-preview"><MaterialCanvas key={pages[index].id} page={pages[index]} editing={stage === "manual"} showRegions={stage === "manual"} onRegion={setBox} disabled={!!busy} /><div className="pager"><button className="icon-button" onClick={() => { setIndex(i => i - 1); setBox(null); }} disabled={index === 0 || !!busy} aria-label="上一页教材"><ChevronLeft size={18} /></button><span>第 {index + 1} / {pages.length} 页</span><button className="icon-button" onClick={() => { setIndex(i => i + 1); setBox(null); }} disabled={index === pages.length - 1 || !!busy} aria-label="下一页教材"><ChevronRight size={18} /></button></div></div>
        <div className="editor-side">{stage === "preview" ? <><span className="eyebrow">A LESSON, JUST FOR YOU</span><h3>让教材活起来</h3><p>AI 会识别页面中的单词和图片，安排讲解、圈选和跟读练习。</p><div className="feature-line"><Check size={17} /> 保留教材原来的样子</div><div className="feature-line"><Check size={17} /> 每一步都能听、能回应</div><div className="feature-line"><Check size={17} /> 备课后可检查对象标注</div>{!connected && <div className="soft-notice">AI 服务尚未配置。你仍然可以手动圈定对象，生成可以上课的练习。</div>}<label className="checkbox-line"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />我是家长，同意将这些教材页面发送给 AI 服务备课。</label><button className="button primary full" onClick={() => void analyze()} disabled={!connected || !!busy}><Sparkles size={17} /> AI 帮我备课</button><button className="button secondary full" onClick={() => { setStage("manual"); setError(""); }} disabled={!!busy}><ScanLine size={17} /> 手动标注备课</button></> : <><span className="eyebrow">MAKE IT INTERACTIVE</span><h3>告诉老师，学什么</h3><p>在教材上拖出一个框，标出图片或单词，再填写名称。每个对象会生成一道圈选题和一道跟读题。</p><div className={`region-status ${box ? "ready" : ""}`}><ScanLine size={17} />{box ? "区域已选好，填写下面的名称" : "先在左侧拖动，框出学习对象"}</div><label className="field">英文单词或短语<input value={english} onChange={e => setEnglish(e.target.value)} placeholder="例如 apple" maxLength={100} /></label><label className="field">中文含义<input value={chinese} onChange={e => setChinese(e.target.value)} placeholder="例如 苹果" maxLength={100} onKeyDown={e => { if (e.key === "Enter") addObject(); }} /></label><button className="button secondary full" onClick={addObject} disabled={!box || !english.trim() || !chinese.trim()}><Plus size={16} /> 添加对象</button><div className="object-list">{pages[index].objects.map(o => <div key={o.id}><span><strong>{o.label}</strong> {o.chinese}</span><button className="icon-button small" aria-label={`删除 ${o.label}`} onClick={() => setPages(old => old.map((p, i) => i === index ? { ...p, objects: p.objects.filter(item => item.id !== o.id) } : p))}><Trash2 size={14} /></button></div>)}</div></>}
        </div></div>
      <div className="modal-footer"><button className="text-button" disabled={!!busy} onClick={() => { if (stage === "manual") setStage("preview"); else { setStage("upload"); setPages([]); } }}><ArrowLeft size={16} /> 返回</button>{stage === "manual" && <button className="button primary" disabled={!pages.some(p => p.objects.length) || !!busy} onClick={() => { setResult(makeManualBook(title, pages)); setStage("result"); }}>生成练习 <ArrowRight size={17} /></button>}<span className="muted">{pages.length} 页教材 · {pages.reduce((sum, p) => sum + p.objects.length, 0)} 个对象</span></div>
    </>}
    {stage === "result" && result && <><div className="result-banner"><span className="upload-icon"><BookOpen size={29} /></span><div><h3>{result.title}</h3><p>{result.lessons.length} 节课 · {result.pages.length} 页教材 · {result.source === "ai" ? "AI 备课，请家长检查后开始" : "按你标注的对象生成练习"}</p></div></div><div className="generated-lessons">{result.lessons.map((lesson, i) => <div key={lesson.id}><span className="lesson-number">{String(i + 1).padStart(2, "0")}</span><div><strong>{lesson.title}</strong><p>{lesson.words.join(" · ")}</p></div><span>{lesson.steps.length} 步</span></div>)}</div><div className="modal-footer"><button className="text-button" disabled={!!busy} onClick={() => { setStage("manual"); setError(""); }}>检查 / 重新标注教材</button><button className="button primary" disabled={!!busy} onClick={() => void save(result)}>保存并开始学习 <ArrowRight size={17} /></button></div></>}
    {busy && <div className="busy-status" role="status"><LoaderCircle className="spin" size={20} /><span>{busy}</span></div>}
  </Modal>;
}
