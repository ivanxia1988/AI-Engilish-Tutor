import { authorize } from '@/lib/ai';
import { handleVoiceSession } from '@/lib/voice-bridge';
import { domesticConfig } from '@/lib/voice-server';

export async function POST(request: Request) {
  return handleVoiceSession(request, { authorize: request => authorize(request, { requireOpenAIKey: false, requireChildData: false }), config: domesticConfig });
}
