import { jsonEvent, type VoiceCommand, type VoiceEvent, type VoiceProtocol, type VoiceProtocolOptions, type VoiceTool } from './types';

/**
 * Seeduplex 3.0 uses JSON text frames. This is NOT the older binary S2S protocol.
 * Authentication belongs in the server WebSocket handshake (X-Api-Key), never here.
 * Official API: https://docs.volcengine.com/docs/doubao-voice/end-to-end-real-time-voice-full-duplex-version?lang=zh
 * Audio/lifecycle notes: https://docs.volcengine.com/docs/doubao-voice/access-must-read?lang=zh
 */
export const DOUBAO_VOICE_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue';
export const DOUBAO_VOICE_MODEL = '1.2.6.1';
export const DOUBAO_VOICE_DEFAULT_VOICE = 'zh_female_vv_jupiter_bigtts';

const textField = (event: Record<string, any>): string => {
  for (const value of [event.text, event.delta, event.transcript, event.content]) if (typeof value === 'string') return value;
  return '';
};
const itemId = (event: Record<string, any>): string | undefined => {
  const value = event.item_id ?? event.item?.id;
  return typeof value === 'string' && value.length <= 200 ? value : undefined;
};

/** speech_text_buffer.commit is literal speech, not an LLM instruction API. */
function spokenText(text: string) {
  const value = text.trim();
  if (!value) throw new Error('豆包播报内容不能为空。');
  // The common classroom client should pass a learner-facing question derived from
  // the current step. Never read a coaching control message or a JSON state aloud.
  if (/^[{\[]|^(?:Lead the current|Rephrase the task|Give one specific textbook|Demonstrate a short model|Verified coaching facts:|You are |Application |Continue teaching|Request (?:the )?next)/i.test(value)) return "Let's look at the picture. What can you see?";
  return value.slice(0, 1600);
}

export function createDoubaoProtocol(options: VoiceProtocolOptions = {}): VoiceProtocol {
  let requestedSession = false, instructions = '', tools: VoiceTool[] = [], counter = 0;
  let childItem = '', childText = '', childFinal = true;
  let teacherItem = '', teacherText = '';
  const wire = (type: string, fields: Record<string, unknown> = {}) => JSON.stringify({ type, event_id: `leaf_doubao_${++counter}`, ...fields });
  const config = () => ({
    model: options.model || DOUBAO_VOICE_MODEL,
    instructions,
    audio: {
      input: { format: { type: 'pcm', rate: 16000 } },
      output: { format: { type: 'pcm_s16le', rate: 24000 }, voice: options.voice || DOUBAO_VOICE_DEFAULT_VOICE, speed: 0, loudness: 0 },
    },
    tools,
  });
  const childId = (event: Record<string, any>, begin = false) => {
    const explicit = itemId(event);
    if (begin || childFinal || !childItem || (explicit && explicit !== childItem)) {
      childItem = explicit || `doubao_child_${++counter}`;
      childText = ''; childFinal = false;
    }
    return childItem;
  };
  const teacherId = (event: Record<string, any>) => {
    const explicit = itemId(event);
    if (!teacherItem || (explicit && explicit !== teacherItem)) { teacherItem = explicit || `doubao_teacher_${++counter}`; teacherText = ''; }
    return teacherItem;
  };
  return {
    id: 'doubao', inputSampleRate: 16000, outputSampleRate: 24000, frameMs: 20,
    commands(command: VoiceCommand) {
      switch (command.type) {
        case 'configure': {
          instructions = command.instructions; tools = command.tools;
          const type = requestedSession ? 'session.update' : 'session.create'; requestedSession = true;
          return [wire(type, { session: config() })];
        }
        case 'context':
          instructions = command.instructions;
          return [wire('session.update', { session: config() })];
        case 'audio': return [wire('input_audio_buffer.append', { audio: command.audio })];
        case 'commit': return [wire('input_audio_buffer.commit')];
        case 'cancel': return [wire('response.cancel')];
        case 'mute': return [wire(command.muted ? 'input_audio_mute.commit' : 'input_audio_unmute.commit')];
        case 'speak': return [wire('speech_text_buffer.commit', { text: spokenText(command.text) })];
        case 'user_text':
          // The documented context API requires paired historical QA and does not
          // create a new text question. Use the application's text agent instead.
          throw new Error('豆包全双工接口的文字问答请通过课堂文字老师处理，不能把朗读接口当成文字提问。');
        case 'tool_result': return [wire('conversation.item.create', { items: [{ call_id: command.callId, role: 'tool', content: [{ type: 'input_text', text: command.output }] }] })];
        case 'close': return [wire('session.close')];
      }
    },
    parse(raw: unknown): VoiceEvent[] {
      const event = jsonEvent(raw); if (!event || typeof event.type !== 'string') return [];
      switch (event.type) {
        case 'session.created': return [{ type: 'session_created', ...(typeof event.session?.id === 'string' ? { sessionId: event.session.id } : {}) }, { type: 'configured' }];
        case 'session.updated': return [{ type: 'configured' }];
        case 'session.closed': return [{ type: 'closed' }];
        case 'conversation.item.input_audio_transcription.started':
          childId(event, true); return [{ type: 'speech_start' }];
        case 'conversation.item.input_audio_transcription.delta': {
          const id = childId(event); childText = textField(event) || childText;
          return childText ? [{ type: 'transcript', role: 'child', text: childText, final: false, replace: true, itemId: id }] : [];
        }
        case 'conversation.item.input_audio_transcription.completed': {
          const id = childId(event); childText = textField(event) || childText; childFinal = true;
          return [...(childText ? [{ type: 'transcript' as const, role: 'child' as const, text: childText, final: true, replace: true, itemId: id }] : []), { type: 'speech_end' }];
        }
        case 'conversation.item.input_audio_transcription.failed':
          childFinal = true;
          return [{ type: 'error', code: 'transcription_failed', message: '豆包未能识别这次语音，请重新说一次。' }, { type: 'speech_end' }];
        case 'input_audio_buffer.committed': return [{ type: 'speech_end' }];
        case 'response.output_text.delta': {
          const id = teacherId(event), text = textField(event); if (!text) return [];
          teacherText += text;
          return [{ type: 'transcript', role: 'teacher', text, final: false, itemId: id }];
        }
        case 'response.output_text.done': {
          const id = teacherId(event), text = textField(event) || teacherText;
          return text ? [{ type: 'transcript', role: 'teacher', text, final: true, replace: true, itemId: id }] : [];
        }
        case 'response.output_audio.started': return [{ type: 'response_start' }];
        case 'response.output_audio.delta': {
          const audio = typeof event.delta === 'string' ? event.delta : typeof event.audio === 'string' ? event.audio : '';
          return audio ? [{ type: 'audio', audio, sampleRate: 24000 }] : [];
        }
        case 'response.output_audio.done':
        case 'response.done':
        case 'response.canceled':
          teacherItem = ''; teacherText = '';
          // response.done carries token usage. Do not mislabel token counts as seconds.
          return [{ type: 'response_done' }];
        case 'response.function_call_arguments.done': {
          const items: unknown[] = Array.isArray(event.items) ? event.items : [];
          return items.flatMap(value => {
            const call = jsonEvent(value); if (!call || typeof call.call_id !== 'string' || typeof call.name !== 'string') return [];
            const args = typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {});
            return [{ type: 'tool' as const, callId: call.call_id, name: call.name, arguments: args }];
          });
        }
        case 'error': {
          const rawCode = event.error?.code ?? event.status_code ?? event.code;
          const code = typeof rawCode === 'number' && Number.isFinite(rawCode) ? String(rawCode) : typeof rawCode === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,48}$/.test(rawCode) ? rawCode : 'provider_error';
          // Upstream errors can echo credentials, request content or account details.
          return [{ type: 'error', code, message: '豆包实时语音返回错误，请检查服务开通、音色和服务端配置。' }];
        }
        default: return [];
      }
    },
  };
}
