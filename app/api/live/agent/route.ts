import { aiConfig, ApiError, authorize, errorResponse, readJson, structuredResponse } from '@/lib/ai';
import { agentInputSchema, agentInstructions, agentOutputFormat, agentResultSchema } from '@/lib/live-agent';
import { verifyLiveTicket } from '@/lib/live-ticket';
import { ServerTimer } from '@/lib/server-timing';
export async function POST(request: Request) {
  const timer = new ServerTimer('agent');
  let model: string | undefined;
  try {
    const user = await authorize(request);
    const input = agentInputSchema.parse(await readJson(request, 100_000));
    if (!await verifyLiveTicket(aiConfig().key!, input.closeToken, input.sessionId, user.userId)) throw new ApiError(403, '实时课堂已失效，请重新连接。');
    const { sessionId: _sessionId, closeToken: _closeToken, ...data } = input;
    console.info(JSON.stringify({ scope: 'littleleaf.agent', event: 'started', session: input.sessionId, reason: input.reason, fragments: input.history.length, marks: input.context.annotations?.markCount || 0 }));
    model = aiConfig().liveBackend;
    const result = agentResultSchema.parse(await structuredResponse(agentInstructions(input.reason), [{ type: 'input_text', text: JSON.stringify(data) }], agentOutputFormat, 'classroom_agent', 1400, model, 20_000, timer.recordUpstream));
    if (input.reason === 'attention') { result.action = { type: 'none', objectIds: [], text: '' }; if (result.decision !== 'redirect') { result.decision = 'wait'; result.english = ''; result.chinese = ''; } }
    console.info(JSON.stringify({ scope: 'littleleaf.agent', event: 'completed', session: input.sessionId, reason: input.reason, decision: result.decision, action: result.action.type }));
    const timing = timer.finish(200, model);
    return Response.json({ ...result, contextKey: input.context.contextKey, performance: timing.performance }, { headers: timing.headers });
  } catch (error) { return timer.error(errorResponse(error), model); }
}
