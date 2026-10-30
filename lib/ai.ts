import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { ApiError } from "./http";
export { ApiError, readJson } from "./http";
export function aiConfig() {
  return { key: env.OPENAI_API_KEY || process.env.OPENAI_API_KEY, model: env.OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-6-astra", transcribe: env.OPENAI_TRANSCRIBE_MODEL || process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe", childDataReady: (env.OPENAI_CHILD_DATA_READY || process.env.OPENAI_CHILD_DATA_READY) === "true", liveModel: env.OPENAI_LIVE_MODEL || process.env.OPENAI_LIVE_MODEL || "gpt-live-1", liveVoice: env.OPENAI_LIVE_VOICE || process.env.OPENAI_LIVE_VOICE || "gleam", liveBackend: env.OPENAI_LIVE_BACKEND_MODEL || process.env.OPENAI_LIVE_BACKEND_MODEL || "gpt-6-luna" };
}
export async function authorize(request: Request, options: { requireChildData?: boolean; requireOpenAIKey?: boolean } = {}) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "请从当前应用发起请求。");
  const user = await getChatGPTUser();
  if (!user) throw new ApiError(401, "请先登录，再使用 AI 老师。");
  if (options.requireOpenAIKey !== false && !aiConfig().key) throw new ApiError(503, "AI 老师还未连接。请在服务端配置 OPENAI_API_KEY，或先体验演示课堂。");
  if (options.requireChildData !== false && !aiConfig().childDataReady) throw new ApiError(503, "儿童课堂的数据处理配置尚未完成，请家长联系应用管理员。演示课堂仍可使用。");
  return user;
}
export async function callOpenAI(path: string, init: RequestInit, timeout = 90_000) {
  let response: Response;
  try { response = await fetch(`https://api.openai.com/v1/${path}`, { ...init, headers: { Authorization: `Bearer ${aiConfig().key}`, ...init.headers }, signal: AbortSignal.timeout(timeout) }); }
  catch { throw new ApiError(504, "AI 连接超时，请检查网络后重试。你的当前进度已保留。"); }
  if (!response.ok) {
    console.warn(JSON.stringify({ scope: 'littleleaf.openai', status: response.status, requestId: response.headers.get('x-request-id') }));
    // Never return provider error bodies: they may contain request content or account details.
    const message = response.status === 429 ? "AI 服务暂时繁忙或额度不足，请稍后重试。" : response.status === 401 ? "AI 密钥不可用，请家长检查服务端配置。" : "AI 服务暂时无法完成请求，请稍后重试。";
    throw new ApiError(response.status === 429 ? 429 : 502, message);
  }
  return response;
}
export async function structuredResponse(instructions: string, content: unknown[], schema: object, name: string, maxOutput = 10000, model = aiConfig().model, timeout = 90_000, onUpstreamTiming?: (milliseconds: number) => void) {
  const began = performance.now();
  let result: { status: string; output?: { content?: { type: string; text?: string }[] }[] };
  try {
    const response = await callOpenAI("responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, ...(/^gpt-6/.test(model) ? { reasoning: { effort: "low" } } : {}), store: false, instructions, input: [{ role: "user", content }], text: { format: { type: "json_schema", name, strict: true, schema } }, max_output_tokens: maxOutput }) }, timeout);
    result = await response.json() as typeof result;
  } finally { onUpstreamTiming?.(performance.now() - began); }
  if (result.status !== "completed") throw new ApiError(502, "教材解析未完成，请减少页数后重试。");
  const output = result.output?.flatMap(item => item.content ?? []).filter(item => item.type === "output_text").map(item => item.text).join("");
  if (!output) throw new ApiError(502, "AI 暂时无法处理这些内容，请换一页教材重试。");
  try { return JSON.parse(output); } catch { throw new ApiError(502, "AI 返回的内容不完整，请重试。"); }
}
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.name === "ZodError") return Response.json({ error: "内容格式不正确，请检查教材或重新打开课堂。" }, { status: 400 });
  return Response.json({ error: "这次操作未能完成，请稍后重试。" }, { status: 500 });
}
