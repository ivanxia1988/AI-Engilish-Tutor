import { aiConfig, ApiError, authorize, errorResponse, readJson } from '@/lib/ai';
import { diagnosticsSchema } from '@/lib/live-diagnostics';
import { verifyLiveTicket } from '@/lib/live-ticket';
export async function POST(request: Request) {
  try {
    const user = await authorize(request);
    const input = diagnosticsSchema.parse(await readJson(request, 12_000));
    if (!await verifyLiveTicket(aiConfig().key!, input.closeToken, input.sessionId, user.userId)) throw new ApiError(403, '课堂诊断票据已失效。');
    // Operation metadata only. No audio, transcripts, textbook content, labels or credentials.
    for (const event of input.events) console.info(JSON.stringify({ scope: 'littleleaf.live', session: input.sessionId, ...event }));
    return Response.json({ accepted: input.events.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
