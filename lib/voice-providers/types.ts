/** Vendor-independent wire contract. No credentials or raw provider payloads are exported to reports. */
export type DomesticProviderId = 'qwen' | 'doubao' | 'glm';
export type VoiceWire = string | ArrayBuffer | Uint8Array;
export type VoiceTool = { type: 'function'; name: string; description: string; parameters: Record<string, unknown> };
export type VoiceCommand =
  | { type: 'configure'; instructions: string; tools: VoiceTool[] }
  | { type: 'context'; instructions: string }
  | { type: 'speak'; text: string }
  | { type: 'user_text'; text: string }
  | { type: 'audio'; audio: string }
  | { type: 'commit' }
  | { type: 'mute'; muted: boolean }
  | { type: 'cancel' }
  | { type: 'tool_result'; callId: string; output: string }
  | { type: 'close' };
export type VoiceEvent =
  | { type: 'session_created'; sessionId?: string }
  | { type: 'configured' }
  | { type: 'transcript'; role: 'child' | 'teacher'; text: string; final: boolean; replace?: boolean; itemId?: string }
  | { type: 'audio'; audio: string; sampleRate: number }
  | { type: 'speech_start' | 'speech_end' | 'response_start' | 'response_done' | 'closed' }
  | { type: 'tool'; callId: string; name: string; arguments: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'usage'; seconds: number };
export interface VoiceProtocol {
  readonly id: DomesticProviderId;
  readonly inputSampleRate: number;
  readonly outputSampleRate: number;
  /** Audio frames must be paced in real time. A provider can require a larger frame to stay below QPS caps. */
  readonly frameMs: number;
  commands(command: VoiceCommand): VoiceWire[];
  parse(raw: unknown): VoiceEvent[];
}
export type VoiceProtocolOptions = { model?: string; voice?: string };
export function jsonEvent(raw: unknown): Record<string, any> | null {
  try { const value = typeof raw === 'string' ? JSON.parse(raw) : raw; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null; } catch { return null; }
}
