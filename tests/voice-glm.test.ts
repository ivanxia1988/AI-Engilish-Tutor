import test from 'node:test';
import assert from 'node:assert/strict';
import { createGLMProtocol } from '../lib/voice-providers/glm.ts';
import type { VoiceWire } from '../lib/voice-providers/types.ts';
const decoded = (values: VoiceWire[]) => values.map(value => JSON.parse(value as string));
const tool = { type: 'function' as const, name: 'highlight_objects', description: 'Circle verified textbook objects.', parameters: { type: 'object', properties: { objectIds: { type: 'array', items: { type: 'string' } } }, required: ['objectIds'] } };

test('GLM uses native PCM duplex, server VAD and the configured classroom/tools', () => {
  const protocol = createGLMProtocol();
  assert.equal(protocol.inputSampleRate, 16_000); assert.equal(protocol.outputSampleRate, 24_000); assert.equal(protocol.frameMs, 100);
  const [event] = decoded(protocol.commands({ type: 'configure', instructions: 'Current lesson: fruit.', tools: [tool] }));
  assert.equal(event.type, 'session.update'); assert.equal(event.session.model, 'glm-realtime-flash'); assert.equal(event.session.voice, 'tongtong');
  assert.equal(event.session.input_audio_format, 'pcm16'); assert.equal(event.session.output_audio_format, 'pcm');
  assert.deepEqual(event.session.turn_detection, { type: 'server_vad', create_response: true, interrupt_response: true });
  assert.deepEqual(event.session.tools, [tool]); assert.equal(event.session.beta_fields.auto_search, false); assert.equal(event.session.beta_fields.greeting_config.enable, false);
  const [update] = decoded(protocol.commands({ type: 'context', instructions: 'Current lesson: animals. Application confirmed cat.' }));
  assert.equal(update.session.instructions, 'Current lesson: animals. Application confirmed cat.'); assert.deepEqual(update.session.tools, [tool]);
  const custom = decoded(createGLMProtocol({ model: 'glm-realtime-air', voice: 'xiaochen' }).commands({ type: 'configure', instructions: '', tools: [] }))[0];
  assert.equal(custom.session.model, 'glm-realtime-air'); assert.equal(custom.session.voice, 'xiaochen');
});

test('GLM audio appends preserve PCM base64 and muting clears and suppresses input', () => {
  const protocol = createGLMProtocol();
  assert.equal(decoded(protocol.commands({ type: 'audio', audio: 'AQACAA==' }))[0].audio, 'AQACAA==');
  assert.deepEqual(decoded(protocol.commands({ type: 'mute', muted: true })).map(e => e.type), ['input_audio_buffer.clear']);
  assert.deepEqual(protocol.commands({ type: 'audio', audio: 'AQACAA==' }), []); assert.deepEqual(protocol.commands({ type: 'commit' }), []);
  protocol.commands({ type: 'mute', muted: false });
  assert.equal(protocol.commands({ type: 'audio', audio: 'AQACAA==' }).length, 1);
  assert.deepEqual(decoded(protocol.commands({ type: 'commit' })).map(e => e.type), ['input_audio_buffer.commit', 'response.create']);
});

test('GLM user text and teaching cues retain their different roles and explicitly request a response', () => {
  const protocol = createGLMProtocol();
  const [user, response] = decoded(protocol.commands({ type: 'user_text', text: 'What is this?' }));
  assert.equal(user.item.role, 'user'); assert.deepEqual(user.item.content, [{ type: 'input_text', text: 'What is this?' }]); assert.equal(response.type, 'response.create');
  const [cue] = decoded(protocol.commands({ type: 'speak', text: 'Ask the learner to point to the apple.' }));
  assert.equal(cue.item.role, 'system'); assert.match(cue.item.content[0].text, /own words/);
  assert.equal(decoded(protocol.commands({ type: 'cancel' }))[0].type, 'response.cancel');
  assert.deepEqual(protocol.commands({ type: 'user_text', text: '  ' }), []); assert.deepEqual(protocol.commands({ type: 'speak', text: '' }), []); assert.deepEqual(protocol.commands({ type: 'close' }), []);
});

test('GLM maps session readiness, VAD, ASR, audio and final transcript without duplicating text', () => {
  const protocol = createGLMProtocol();
  assert.deepEqual(protocol.parse('{"type":"session.created","session":{"id":"test-session"}}'), [{ type: 'session_created', sessionId: 'test-session' }]);
  assert.deepEqual(protocol.parse({ type: 'session.updated' }), [{ type: 'configured' }]);
  assert.deepEqual(protocol.parse({ type: 'input_audio_buffer.speech_started' }), [{ type: 'speech_start' }]);
  assert.deepEqual(protocol.parse({ type: 'input_audio_buffer.speech_stopped' }), [{ type: 'speech_end' }]);
  assert.deepEqual(protocol.parse({ type: 'response.created' }), [{ type: 'response_start' }]);
  assert.deepEqual(protocol.parse({ type: 'response.audio.delta', delta: 'AQACAA==' }), [{ type: 'audio', audio: 'AQACAA==', sampleRate: 24_000 }]);
  assert.deepEqual(protocol.parse({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'child-turn', transcript: 'apple' }), [{ type: 'transcript', role: 'child', text: 'apple', final: true, replace: true, itemId: 'child-turn' }]);
  assert.deepEqual(protocol.parse({ type: 'response.audio_transcript.delta', item_id: 'teacher-turn', delta: 'Look ' }), [{ type: 'transcript', role: 'teacher', text: 'Look ', final: false, itemId: 'teacher-turn' }]);
  assert.deepEqual(protocol.parse({ type: 'response.audio_transcript.done', item_id: 'teacher-turn', transcript: 'Look here.' }), [{ type: 'transcript', role: 'teacher', text: 'Look here.', final: true, replace: true, itemId: 'teacher-turn' }]);
  assert.deepEqual(protocol.parse({ type: 'response.text.delta', delta: 'Look ' }), []);
  assert.deepEqual(protocol.parse({ type: 'response.audio.done' }), []); // response.done, not last audio packet, ends a turn.
});

test('GLM defers native function calls until the response ends and reports results in conversation order', () => {
  const protocol = createGLMProtocol();
  const call = { type: 'response.function_call_arguments.done', event_id: 'tool-event', name: 'highlight_objects', arguments: '{"objectIds":["apple"]}' };
  assert.deepEqual(protocol.parse(call), []); assert.deepEqual(protocol.parse(call), []);
  assert.deepEqual(protocol.parse({ type: 'response.done', response: { status: 'completed' } }), [{ type: 'response_done' }, { type: 'tool', callId: 'tool-event', name: 'highlight_objects', arguments: '{"objectIds":["apple"]}' }]);
  const [output, respond] = decoded(protocol.commands({ type: 'tool_result', callId: 'tool-event', output: '{"ok":true}' }));
  assert.deepEqual(output.item, { type: 'function_call_output', object: 'realtime.item', output: '{"ok":true}' }); assert.equal(respond.type, 'response.create');
  protocol.parse({ ...call, event_id: 'cancelled-tool' }); protocol.commands({ type: 'cancel' });
  assert.deepEqual(protocol.parse({ type: 'response.done', response: { status: 'cancelled' } }), [{ type: 'response_done' }]);
  protocol.parse({ ...call, event_id: 'interrupted-tool' }); protocol.parse({ type: 'input_audio_buffer.speech_started' });
  assert.deepEqual(protocol.parse({ type: 'response.done' }), [{ type: 'response_done' }]);
});

test('GLM malformed/unsupported events do not produce audio, usage or provider error-body leaks', () => {
  const protocol = createGLMProtocol();
  for (const raw of ['bad json', '[]', null, 42, { type: 'response.audio.delta', delta: null }, { type: 'response.audio_transcript.delta', delta: 2 }, { type: 'heartbeat' }, { type: 'rate_limits.updated' }]) assert.deepEqual(protocol.parse(raw), []);
  const result = protocol.parse({ type: 'error', error: { code: 'invalid_event', message: 'Raw provider body containing a credential should never escape.' } });
  assert.equal(result[0].type, 'error'); assert.doesNotMatch(JSON.stringify(result), /credential/);
  assert.deepEqual(protocol.parse({ type: 'response.done', response: { usage: { total_tokens: 0 } } }), [{ type: 'response_done' }]);
});
