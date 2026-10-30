import { aiConfig, ApiError, authorize, callOpenAI, errorResponse, readJson } from "@/lib/ai";
import { buildLiveSession, isReceiveOnlyOffer, liveSessionSchema } from "@/lib/live-protocol";
import { makeLiveTicket } from "@/lib/live-ticket";
import { ServerTimer } from '@/lib/server-timing';
export async function POST(request: Request) {
  const timer = new ServerTimer('session');
  let model: string | undefined;
  try {
    const user = await authorize(request, { requireChildData: false });
    const body = liveSessionSchema.parse(await readJson(request, 180_000));
    if (body.mode === "classroom" && !aiConfig().childDataReady) throw new ApiError(503, "儿童数据处理配置尚未完成。家长可以先运行不采集声音的连接测试。");
    if (body.mode === "probe" && !isReceiveOnlyOffer(body.sdp)) throw new ApiError(400, "连接测试必须关闭发送音频，只接收连接状态。");
    model = aiConfig().liveModel;
    const result = await timer.upstream(async () => {
      const response = await callOpenAI("live/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session: buildLiveSession(aiConfig(), body.mode === "classroom" ? body.context : undefined), transport: { type: "webrtc", sdp: body.sdp } }) }, 35_000);
      return await response.json() as { session?: { id?: string }; transport?: { sdp?: string } };
    });
    const sessionId = result.session?.id, sdp = result.transport?.sdp;
    if (!sessionId || !sdp) throw new ApiError(502, "实时课堂没有返回完整的连接信息，请重试。");
    console.info(JSON.stringify({ scope: 'littleleaf.live', event: 'session_created', session: sessionId, mode: body.mode, delegation: 'client' }));
    const closeToken = await makeLiveTicket(aiConfig().key!, sessionId, user.userId);
    const timing = timer.finish(200, model);
    return Response.json({ sessionId, sdp, closeToken, performance: timing.performance }, { headers: timing.headers });
  } catch (error) { return timer.error(errorResponse(error), model); }
}
