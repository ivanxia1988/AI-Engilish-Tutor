import { aiConfig, ApiError, authorize, callOpenAI, errorResponse } from "@/lib/ai";
import { readLimitedBody } from "@/lib/http";
export async function POST(request: Request) {
  try {
    await authorize(request);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data;")) throw new ApiError(415, "请提交录音文件。");
    const bytes = await readLimitedBody(request, 5_000_000);
    const data = await new Response(bytes as BodyInit, { headers: { "Content-Type": contentType } }).formData();
    const audio = data.get("audio");
    if (!(audio instanceof File) || audio.size === 0 || audio.size > 4_500_000 || !/^(audio\/(webm|mp4|ogg|wav|mpeg)|video\/webm)/.test(audio.type)) throw new ApiError(400, "录音格式无法读取，请重新录制。");
    const form = new FormData(); form.append("file", audio, audio.name); form.append("model", aiConfig().transcribe);
    form.append("prompt", "A young child practicing English with a bilingual Chinese-English teacher. The child may speak either Chinese or English.");
    const result = await callOpenAI("audio/transcriptions", { method: "POST", body: form }, 40_000);
    const transcript = await result.json() as { text?: string };
    return Response.json({ text: transcript.text || "" });
  } catch (error) { return errorResponse(error); }
}
