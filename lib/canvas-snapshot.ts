import type { BookPage, Stroke } from "./types";
/** Produce the same page + child marks the learner sees, with no camera/screen capture. */
export async function classroomSnapshot(page: BookPage, strokes: Stroke[], teacherObjectIds: string[] = []): Promise<string> {
  const image = new Image(); image.src = page.image; await image.decode();
  const scale = Math.min(1, 1200 / Math.max(page.width, page.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(page.width * scale); canvas.height = Math.round(page.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fffdf5"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.lineWidth = Math.max(3, canvas.width / 230); ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const o of page.objects.filter(o => teacherObjectIds.includes(o.id))) {
    const cx = o.box.x + o.box.w / 2, cy = o.box.y + o.box.h / 2;
    ctx.strokeStyle = '#caa74a'; ctx.beginPath();
    ctx.ellipse(cx * canvas.width, cy * canvas.height, Math.min(o.box.w / 2 + .012, cx, 1 - cx) * canvas.width, Math.min(o.box.h / 2 + .012, cy, 1 - cy) * canvas.height, 0, 0, Math.PI * 2); ctx.stroke();
  }
  for (const stroke of strokes.slice(-6)) {
    if (!stroke.points.length) continue;
    ctx.strokeStyle = stroke.color; ctx.beginPath();
    if (stroke.tool === "circle" && stroke.points.length > 1) {
      const xs = stroke.points.map(p => p.x), ys = stroke.points.map(p => p.y), left = Math.min(...xs), top = Math.min(...ys), w = Math.max(...xs) - left, h = Math.max(...ys) - top;
      ctx.ellipse((left + w / 2) * canvas.width, (top + h / 2) * canvas.height, w * canvas.width / 2, h * canvas.height / 2, 0, 0, Math.PI * 2);
    } else if (stroke.points.length <= 2) ctx.arc(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height, canvas.width * .012, 0, Math.PI * 2);
    else stroke.points.forEach((p, i) => i ? ctx.lineTo(p.x * canvas.width, p.y * canvas.height) : ctx.moveTo(p.x * canvas.width, p.y * canvas.height));
    ctx.stroke();
  }
  return canvas.toDataURL("image/jpeg", .82);
}
