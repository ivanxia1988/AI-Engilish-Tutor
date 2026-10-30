import { aiConfig } from "@/lib/ai";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { voiceStatuses } from '@/lib/voice-server';
export async function GET() { const config = aiConfig(), configured = Boolean(config.key && config.childDataReady); return Response.json({ configured, keyConfigured: Boolean(config.key), liveReady: configured, childDataReady: config.childDataReady, signedIn: Boolean(await getChatGPTUser()), mode: configured ? "connected" : "demo", voiceProviders: voiceStatuses() }, { headers: { "Cache-Control": "no-store" } }); }
