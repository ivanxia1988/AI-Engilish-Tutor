import { z } from "zod";
import { aiConfig, ApiError, authorize, errorResponse, readJson } from "@/lib/ai";
import { verifyLiveTicket } from "@/lib/live-ticket";
const schema = z.object({ sessionId: z.string().min(1).max(150), closeToken: z.string().max(1500) });
export async function POST(request: Request) {
  try {
    const user = await authorize(request, { requireChildData: false });
    const input = schema.parse(await readJson(request, 3000));
    if (!await verifyLiveTicket(aiConfig().key!, input.closeToken, input.sessionId, user.userId)) throw new ApiError(403, "不能关闭不属于当前登录身份的会话。");
    const response = await fetch(`https://api.openai.com/v1/live/sessions/${encodeURIComponent(input.sessionId)}/hangup`, { method: "POST", headers: { Authorization: `Bearer ${aiConfig().key}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok && ![404,409,410].includes(response.status)) throw new ApiError(502, "服务器尚未确认会话关闭，请稍后重新检查。");
    return Response.json({ closed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
