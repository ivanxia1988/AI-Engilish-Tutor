import type { Answer, Box, PageObject, Point, Progress } from "./types.ts";

export function clamp(n: number, min = 0, max = 1) { return Math.max(min, Math.min(max, n)); }
export function normalizedPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Point {
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}
export function pointsBox(points: Point[]): Box {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export function inside(p: Point, b: Box, padding = 0) {
  return p.x >= b.x - padding && p.x <= b.x + b.w + padding && p.y >= b.y - padding && p.y <= b.y + b.h + padding;
}
function polygonContains(p: Point, polygon: Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
/** Resolve spatial intent, never infer correctness from whether a child drew anything. */
export function resolveSelection(points: Point[], objects: PageObject[], tool: "pen" | "circle" = "pen"): { status: "selected" | "ambiguous" | "empty"; ids: string[] } {
  if (!points.length) return { status: "empty", ids: [] };
  const b = pointsBox(points);
  const isTap = b.w < 0.018 && b.h < 0.018;
  if (isTap) {
    const hits = objects.filter(o => inside(points[0], o.box, 0.012)).sort((a, c) => a.box.w * a.box.h - c.box.w * c.box.h);
    return hits.length ? { status: "selected", ids: [hits[0].id] } : { status: "empty", ids: [] };
  }
  const closed = tool === "circle" || (points.length >= 8 && Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < Math.max(0.07, Math.min(b.w, b.h) * 0.45));
  const ids = objects.filter(o => {
    const center = { x: o.box.x + o.box.w / 2, y: o.box.y + o.box.h / 2 };
    if (closed) {
      if (tool === "circle") {
        const rx = b.w / 2, ry = b.h / 2;
        return rx > 0 && ry > 0 && ((center.x - b.x - rx) / rx) ** 2 + ((center.y - b.y - ry) / ry) ** 2 <= 1.16;
      }
      return polygonContains(center, points);
    }
    return points.filter(p => inside(p, o.box)).length / points.length > 0.55;
  }).map(o => o.id);
  return { status: ids.length > 1 ? "ambiguous" : ids.length ? "selected" : "empty", ids };
}
export function normalizeSpeech(value: string) {
  return value.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
export function matchesSpeech(input: string, expected: string): boolean {
  const actual = normalizeSpeech(input), target = normalizeSpeech(expected);
  if (!actual || !target) return false;
  if (actual === target) return true;
  if (/\b(not|no|dont|cant|cannot|isnt|arent|wrong)\b/.test(actual)) return false;
  // Accept a word inside a short sentence, not substrings (e.g. pineapple ≠ apple).
  return (` ${actual} `).includes(` ${target} `);
}
export function recordAnswer(progress: Progress, stepId: string, correct: boolean, answer: string, assisted: boolean): Progress {
  const previous = progress.answers.find(a => a.stepId === stepId);
  const entry: Answer = { stepId, attempts: (previous?.attempts ?? 0) + 1, correct: previous?.correct || correct, assisted: previous?.assisted || assisted, answer };
  return { ...progress, answers: [...progress.answers.filter(a => a.stepId !== stepId), entry], updatedAt: new Date().toISOString() };
}
export function lessonStats(progress: Progress) {
  return { answered: progress.answers.filter(a => a.correct).length, independent: progress.answers.filter(a => a.correct && !a.assisted && a.attempts === 1).length, practiced: progress.answers.length };
}
