import { pointsBox } from './classroom.ts';
import type { Point } from './types.ts';
export type PrototypeMark = { id: string; tool: 'pen' | 'circle'; color: string; points: Point[] };
export function markNearPoint(mark: PrototypeMark, point: Point, tolerance: number, scale: Point = { x: 1, y: 1 }): boolean {
  if (!mark.points.length) return false;
  const points = mark.points.map(p => ({ x: p.x * scale.x, y: p.y * scale.y }));
  const target = { x: point.x * scale.x, y: point.y * scale.y };
  function nearSegment(start: Point, end: Point) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const t = Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(target.x - start.x - t * dx, target.y - start.y - t * dy) <= tolerance;
  }
  if (mark.tool === 'circle' && mark.points.length > 1) {
    const box = pointsBox(points), rx = box.w / 2, ry = box.h / 2;
    if (rx <= 0 || ry <= 0) return false;
    // Measure against the visible outline in pixels, including very flat ellipses.
    const at = (angle: number) => ({ x: box.x + rx + rx * Math.cos(angle), y: box.y + ry + ry * Math.sin(angle) });
    for (let i = 0; i < 128; i++) if (nearSegment(at(i * Math.PI / 64), at((i + 1) * Math.PI / 64))) return true;
    return false;
  }
  if (points.length === 1) return nearSegment(points[0], points[0]);
  return points.slice(1).some((end, i) => nearSegment(points[i], end));
}
