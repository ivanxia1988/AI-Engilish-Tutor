import { jsonEvent, type VoiceCommand, type VoiceEvent, type VoiceProtocol, type VoiceProtocolOptions, type VoiceTool } from './types';

/** GLM's native Realtime protocol, not a text-to-speech wrapper.
 * https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-realtime
 * The trusted relay adds Authorization; this module never receives credentials.
 */
export function createGLMProtocol(options: VoiceProtocolOptions = {}): VoiceProtocol {
  let instructions = '', tools: VoiceTool[] = [], muted = false, counter = 0;
  let pendingTools: Extract<VoiceEvent, { type: 'tool' }>[] = [];
  const seenTools = new Set<string>();
  const encode = (type: string, data: Record<string, unknown> = {}) => JSON.stringify({ type, event_id: `leaf_glm_${++counter}`, client_timestamp: Date.now(), ...data });
  const session = () => encode('session.update', { session: {
    model: options.model || 'glm-realtime-flash',
    modalities: ['text', 'audio'], instructions, voice: options.voice || 'tongtong',
    input_audio_format: 'pcm16', output_audio_format: 'pcm',
    input_audio_noise_reduction: { type: 'far_field' },
    turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true },
    tools,
    beta_fields: { chat_mode: 'audio', tts_source: 'e2e', auto_search: false, greeting_config: { enable: false } },
  } });
  const message = (role: 'user' | 'system', text: string) => encode('conversation.item.create', { item: { type: 'message', object: 'realtime.item', role, content: [{ type: 'input_text', text }] } });
  function commands(command: VoiceCommand): string[] {
    switch (command.type) {
      case 'configure': instructions = command.instructions; tools = command.tools; return [session()];
      case 'context': instructions = command.instructions; return [session()];
      case 'audio': return muted || !command.audio ? [] : [encode('input_audio_buffer.append', { audio: command.audio })];
      // Server VAD submits audio automatically; commit is available for an explicit manual turn.
      case 'commit': return muted ? [] : [encode('input_audio_buffer.commit'), encode('response.create')];
      case 'user_text': return command.text.trim() ? [message('user', command.text), encode('response.create')] : [];
      case 'speak': return command.text.trim() ? [message('system', `Application teaching cue: ${command.text}\nUse this cue to continue the current lesson naturally in your own words.`), encode('response.create')] : [];
      case 'mute': muted = command.muted; return muted ? [encode('input_audio_buffer.clear')] : [];
      case 'cancel': pendingTools = []; return [encode('response.cancel')];
      // GLM correlates sequential function outputs through conversation order, not call_id.
      case 'tool_result': return [encode('conversation.item.create', { item: { type: 'function_call_output', object: 'realtime.item', output: command.output } }), encode('response.create')];
      // Closing the WebSocket is the documented end-of-session operation.
      case 'close': pendingTools = []; return [];
    }
  }
  function parse(raw: unknown): VoiceEvent[] {
    const event = jsonEvent(raw); if (!event || typeof event.type !== 'string') return [];
    const itemId = typeof event.item_id === 'string' ? event.item_id : undefined;
    switch (event.type) {
      case 'session.created': return [{ type: 'session_created', ...(typeof event.session?.id === 'string' ? { sessionId: event.session.id } : {}) }];
      case 'session.updated': return [{ type: 'configured' }];
      case 'input_audio_buffer.speech_started': pendingTools = []; return [{ type: 'speech_start' }];
      case 'input_audio_buffer.speech_stopped': return [{ type: 'speech_end' }];
      case 'response.created': return [{ type: 'response_start' }];
      case 'response.audio.delta': return typeof event.delta === 'string' && event.delta ? [{ type: 'audio', audio: event.delta, sampleRate: 24_000 }] : [];
      case 'conversation.item.input_audio_transcription.completed': return typeof event.transcript === 'string' && event.transcript ? [{ type: 'transcript', role: 'child', text: event.transcript, final: true, replace: true, itemId }] : [];
      case 'response.audio_transcript.delta': return typeof event.delta === 'string' && event.delta ? [{ type: 'transcript', role: 'teacher', text: event.delta, final: false, itemId }] : [];
      case 'response.audio_transcript.done': return typeof event.transcript === 'string' && event.transcript ? [{ type: 'transcript', role: 'teacher', text: event.transcript, final: true, replace: true, itemId }] : [];
      // With both text/audio modalities GLM can emit parallel text and transcript streams.
      // Use the audio transcript only, avoiding duplicated teacher bubbles.
      case 'response.function_call_arguments.done': {
        const callId = typeof event.call_id === 'string' ? event.call_id : typeof event.event_id === 'string' ? event.event_id : '';
        if (!callId || seenTools.has(callId) || typeof event.name !== 'string' || !event.name || typeof event.arguments !== 'string') return [];
        seenTools.add(callId); if (seenTools.size > 256) seenTools.delete(seenTools.values().next().value!);
        pendingTools.push({ type: 'tool', callId, name: event.name, arguments: event.arguments });
        return [];
      }
      // The official SDK waits for response.done before executing and reporting tools.
      case 'response.done': {
        const cancelled = event.response?.status === 'cancelled';
        const ready = cancelled ? [] : pendingTools; pendingTools = [];
        return [{ type: 'response_done' }, ...ready];
      }
      case 'response.cancelled': pendingTools = []; return [{ type: 'response_done' }];
      case 'error': {
        const code = typeof event.error?.code === 'string' && /^[\w.:-]{1,100}$/.test(event.error.code) ? event.error.code : 'glm_provider_error';
        return [{ type: 'error', code, message: '智谱实时语音请求失败，请检查服务配置或稍后重连。' }];
      }
      case 'conversation.item.input_audio_transcription.failed': return [{ type: 'error', code: 'glm_transcription_failed', message: '这次语音未能识别，请再说一次。' }];
      default: return [];
    }
  }
  return { id: 'glm', inputSampleRate: 16_000, outputSampleRate: 24_000, frameMs: 100, commands, parse };
}
