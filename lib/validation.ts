import { z } from "zod";
const text = z.string().min(1).max(500);
export const objectSchema = z.object({ id: z.string().min(1).max(80), label: text, chinese: text, box: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().positive().max(1), h: z.number().positive().max(1) }).refine(b => b.x + b.w <= 1.005 && b.y + b.h <= 1.005, "对象区域超出了页面。") });
export const stepSchema = z.object({ id: z.string().min(1).max(80), kind: z.enum(["listen", "select", "speak"]), pageId: z.string(), targetId: z.string().nullable(), english: text, chinese: text, hint: text, expected: z.string().max(500).nullable() });
export const lessonSchema = z.object({ id: z.string().min(1).max(80), title: text, subtitle: text, duration: z.number().int().min(1).max(30), words: z.array(text).min(1).max(20), steps: z.array(stepSchema).min(2).max(30) });
export const analysisSchema = z.object({ title: text, pages: z.array(z.object({ id: z.string(), objects: z.array(objectSchema).max(40) })).min(1).max(12), lessons: z.array(lessonSchema).min(1).max(12) });
export function validateAnalysis(value: unknown, pageIds: string[]) {
  const result = analysisSchema.parse(value);
  const ids = new Set<string>();
  if (result.pages.length !== pageIds.length || result.pages.some(p => !pageIds.includes(p.id)) || new Set(result.pages.map(p => p.id)).size !== pageIds.length) throw new Error("教材页码不完整，请重试解析。");
  const lessonIds = new Set<string>(), stepIds = new Set<string>();
  for (const page of result.pages) for (const object of page.objects) {
    if (ids.has(object.id)) throw new Error("教材对象编号重复，请重试解析。");
    ids.add(object.id);
  }
  for (const lesson of result.lessons) {
    if (!lesson.steps.some(step => step.kind !== "listen")) throw new Error("课程缺少互动练习，请重试解析。");
    if (lessonIds.has(lesson.id)) throw new Error("课程编号重复，请重试解析。");
    lessonIds.add(lesson.id);
    for (const step of lesson.steps) {
      if (stepIds.has(step.id)) throw new Error("教学步骤编号重复，请重试解析。");
      stepIds.add(step.id);
      const page = result.pages.find(p => p.id === step.pageId);
      if (!page) throw new Error("课程引用了不存在的页面，请重试解析。");
      if (step.kind === "select" && !step.targetId) throw new Error("圈选练习缺少目标，请重试解析。");
      if (step.targetId && !page.objects.some(o => o.id === step.targetId)) throw new Error("练习目标与教材页面不一致，请重试解析。");
      if (step.kind === "speak" && !step.expected?.trim()) throw new Error("口语练习缺少示范答案，请重试解析。");
    }
  }
  return result;
}
export const uploadPagesSchema = z.object({ age: z.number().int().min(4).max(14), pages: z.array(z.object({ id: z.string().min(1).max(80), image: z.string().max(2_000_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/), width: z.number().int().positive().max(5000), height: z.number().int().positive().max(5000) })).min(1).max(12) });
export const teacherSchema = z.object({ english: z.string().max(700), chinese: z.string().max(700), highlightIds: z.array(z.string()).max(5), assessment: z.enum(["correct", "retry", "none"]) });
