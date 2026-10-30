"use client";
import { useRef, useState } from "react";
import type { BookPage, Box, Point, Stroke } from "@/lib/types";
import { normalizedPoint, pointsBox } from "@/lib/classroom";

export function MaterialCanvas({ page, strokes = [], highlights = [], tool = "pen", color = "#de8169", onStroke, onRegion, onActivity, editing = false, showRegions = false, disabled = false }: { page: BookPage; strokes?: Stroke[]; highlights?: string[]; tool?: "pen" | "circle"; color?: string; onStroke?: (points: Point[], tool: "pen" | "circle") => void; onRegion?: (box: Box) => void; onActivity?: () => void; editing?: boolean; showRegions?: boolean; disabled?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const points = useRef<Point[]>([]);
  const pointer = useRef<number | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const point = (e: React.PointerEvent) => normalizedPoint(e.clientX, e.clientY, svgRef.current!.getBoundingClientRect());
  function down(e: React.PointerEvent<SVGSVGElement>) {
    if (disabled || pointer.current !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); pointer.current = e.pointerId;
    onActivity?.();
    points.current = [point(e)]; setDraft([...points.current]);
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    if (pointer.current !== e.pointerId || points.current.length >= 1800) return;
    onActivity?.();
    const p = point(e);
    if (editing || tool === "circle") points.current = [points.current[0], p]; else points.current.push(p);
    setDraft([...points.current]);
  }
  function up(e: React.PointerEvent<SVGSVGElement>) {
    if (pointer.current !== e.pointerId) return;
    const result = [...points.current];
    pointer.current = null; points.current = []; setDraft([]);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (editing) { const box = pointsBox(result); if (box.w >= 0.02 && box.h >= 0.02) onRegion?.(box); }
    else onStroke?.(result, tool);
  }
  function renderStroke(p: Point[], kind: string, key: string, strokeColor: string) {
    const b = pointsBox(p);
    if (kind === "circle" && p.length > 1) return <ellipse key={key} cx={(b.x + b.w / 2) * 1000} cy={(b.y + b.h / 2) * 1000} rx={b.w * 500} ry={b.h * 500} stroke={strokeColor} />;
    if (p.length < 3) return p[0] ? <circle key={key} cx={p[0].x * 1000} cy={p[0].y * 1000} r="12" stroke={strokeColor} /> : null;
    return <path key={key} d={p.map((a, i) => `${i ? "L" : "M"}${a.x * 1000},${a.y * 1000}`).join(" ")} stroke={strokeColor} />;
  }
  return <div className={`material-canvas ${editing ? "editing" : ""}`} style={{ aspectRatio: `${page.width}/${page.height}`, "--page-ratio": page.width / page.height } as React.CSSProperties}>
    <img className="textbook-image" src={page.image} width={page.width} height={page.height} alt="当前教材页面；圈选或点击页面中的图片和单词来回答老师" draggable={false} />
    <svg ref={svgRef} className="drawing-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { pointer.current = null; points.current = []; setDraft([]); }} role="img" aria-label={editing ? "拖动框选教材对象" : "教材圈画区域，也可使用下方的对象按钮回答"}>
      <g fill="none" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round">
        {page.objects.filter(o => showRegions || highlights.includes(o.id)).map(o => <g key={o.id}>{highlights.includes(o.id) ? <ellipse className="teacher-highlight teacher-circle" data-object-id={o.id} cx={(o.box.x + o.box.w / 2) * 1000} cy={(o.box.y + o.box.h / 2) * 1000} rx={Math.min(o.box.w / 2 + .012, o.box.x + o.box.w / 2, 1 - o.box.x - o.box.w / 2) * 1000} ry={Math.min(o.box.h / 2 + .012, o.box.y + o.box.h / 2, 1 - o.box.y - o.box.h / 2) * 1000} stroke="#caa74a" fill="#e5bd4712" /> : <rect className="object-region" x={o.box.x * 1000} y={o.box.y * 1000} width={o.box.w * 1000} height={o.box.h * 1000} rx="14" fill="#657f5420" stroke="#657f54" strokeDasharray={showRegions ? "8 6" : undefined} />}{showRegions && <text x={o.box.x * 1000 + 7} y={o.box.y * 1000 + 22} fill="#365337" stroke="none" fontSize="18">{o.label}</text>}</g>)}
        {strokes.filter(s => s.pageId === page.id).map(s => renderStroke(s.points, s.tool, s.id, s.color))}
        {editing && draft.length > 1 ? <rect x={pointsBox(draft).x * 1000} y={pointsBox(draft).y * 1000} width={pointsBox(draft).w * 1000} height={pointsBox(draft).h * 1000} stroke="#637e53" fill="#637e5320" /> : renderStroke(draft, tool, "draft", color)}
      </g>
    </svg>
  </div>;
}
