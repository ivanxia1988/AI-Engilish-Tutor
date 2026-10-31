'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { MousePointer2, PenLine, RotateCcw } from 'lucide-react';
import { normalizedPoint, pointsBox } from '../../lib/classroom';
import type { PrototypeMark } from '../../lib/prototype-annotations';

type Tool = 'pointer' | 'pen';
const TOOLS = [{ id: 'pointer', label: '指针', Icon: MousePointer2 }, { id: 'pen', label: '画笔', Icon: PenLine }] as const;

export function usePrototypeAnnotations(disabled: boolean, resetToken: number, onComplete?: (mark: PrototypeMark, bounds: DOMRect) => void) {
  const [tool, setTool] = useState<Tool>('pointer');
  const [marks, setMarks] = useState<PrototypeMark[]>([]);
  const [history, setHistory] = useState<PrototypeMark[][]>([]);
  const [draft, setDraft] = useState<PrototypeMark | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const marksRef = useRef<PrototypeMark[]>([]);
  const drawing = useRef<PrototypeMark | null>(null);
  const pointer = useRef<number | null>(null);
  const sequence = useRef(0);
  function update(next: PrototypeMark[]) { marksRef.current = next; setMarks(next); }
  function remember() {
    const snapshot = marksRef.current;
    setHistory(items => [...items.slice(-29), snapshot]);
  }
  function cancel() {
    const id = pointer.current; pointer.current = null; drawing.current = null; setDraft(null);
    if (id !== null && svg.current?.hasPointerCapture(id)) svg.current.releasePointerCapture(id);
  }
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  useEffect(() => { cancel(); update([]); setHistory([]); setTool('pointer'); }, [resetToken]);
  function point(event: PointerEvent<SVGSVGElement>) { return normalizedPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()); }
  function down(event: PointerEvent<SVGSVGElement>) {
    if (disabled || tool === 'pointer' || pointer.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = event.pointerId;
    drawing.current = { id: String(++sequence.current), tool: 'pen', color: '#c2602a', points: [point(event)] }; setDraft(drawing.current);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    if (pointer.current !== event.pointerId) return;
    const current = drawing.current;
    if (!current || current.points.length >= 1800) return;
    drawing.current = { ...current, points: [...current.points, point(event)] }; setDraft(drawing.current);
  }
  function up(event: PointerEvent<SVGSVGElement>) {
    if (pointer.current !== event.pointerId) return;
    const current = drawing.current;
    if (current) {
      const completed = { ...current, points: [...current.points, point(event)] };
      remember(); update([...marksRef.current.slice(-199), completed]);
      onComplete?.(completed, event.currentTarget.getBoundingClientRect());
    }
    cancel();
  }
  function renderMark(mark: PrototypeMark, isDraft = false) {
    const key = isDraft ? 'draft' : mark.id;
    const props = { stroke: mark.color, fill: 'none', strokeWidth: 3, vectorEffect: 'non-scaling-stroke' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'data-mark': isDraft ? 'draft' : mark.id };
    if (mark.tool === 'circle' && mark.points.length > 1) { const box = pointsBox(mark.points); return <ellipse key={key} {...props} cx={(box.x + box.w / 2) * 1000} cy={(box.y + box.h / 2) * 1000} rx={box.w * 500} ry={box.h * 500} />; }
    return <path key={key} {...props} d={mark.points.map((p, i) => `${i ? 'L' : 'M'}${p.x * 1000},${p.y * 1000}`).join(' ')} />;
  }
  return {
    cancelDraft: cancel,
    chooseTool: (next: Tool) => { cancel(); setTool(next); },
    layer: <svg ref={svg} className={`tp-annotation-layer ${tool !== 'pointer' && !disabled ? 'is-drawing' : ''} tp-tool-${tool}`} viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label="教材标注区域" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel}>{marks.map(mark => renderMark(mark))}{draft && renderMark(draft, true)}</svg>,
    toolbar: <div className="tp-drawing-tools" role="toolbar" aria-label="教材互动工具">{TOOLS.map(({ id, label, Icon }) => <button key={id} type="button" disabled={disabled} aria-label={label} title={label} aria-pressed={tool === id} className={tool === id ? 'is-active' : ''} onClick={() => { cancel(); setTool(id); }}><Icon size={18} /></button>)}<button type="button" disabled={disabled || !history.length} aria-label="撤销笔迹" title="撤销" onClick={() => { cancel(); update(history.at(-1)!); setHistory(history.slice(0, -1)); }}><RotateCcw size={18} /></button></div>,
  };
}
