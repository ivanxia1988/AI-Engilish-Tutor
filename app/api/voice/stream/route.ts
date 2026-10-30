import { authorize } from '@/lib/ai';
import { authorizeVoiceUpgrade, createVoiceBridge, voiceServerError, type VoiceSocket } from '@/lib/voice-bridge';
import { domesticConfig } from '@/lib/voice-server';

export async function GET(request: Request) {
  try {
    const user = await authorizeVoiceUpgrade(request, request => authorize(request, { requireOpenAIKey: false, requireChildData: false }));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    createVoiceBridge(server as unknown as VoiceSocket, { userId: user.userId, config: domesticConfig });
    server.accept();
    return new Response(null, { status: 101, webSocket: client, headers: { 'Cache-Control': 'no-store' } });
  } catch (value) { return voiceServerError(value); }
}
