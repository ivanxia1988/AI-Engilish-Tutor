import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoubaoProtocol, DOUBAO_VOICE_ENDPOINT, DOUBAO_VOICE_MODEL } from '../lib/voice-providers/doubao';
import type { VoiceCommand, VoiceProtocol } from '../lib/voice-providers/types';

const outgoing = (protocol: VoiceProtocol, command: VoiceCommand) => protocol.commands(command).map(value => { assert.equal(typeof value, 'string'); return JSON.parse(value as string); });

test('Doubao Seeduplex configures paced 16k input and 24k int16 output without credentials', () => {
  const protocol = createDoubaoProtocol();
  assert.equal(protocol.id, 'doubao'); assert.equal(protocol.frameMs, 20); assert.equal(protocol.inputSampleRate, 16000); assert.equal(protocol.outputSampleRate, 24000);
  assert.equal(DOUBAO_VOICE_ENDPOINT, 'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue');
  const tools = [{ type: 'function' as const, name: 'highlight_objects', description: 'Circle known objects.', parameters: { type: 'object' } }];
  const [created] = outgoing(protocol, { type: 'configure', instructions: 'Teach the current lesson.', tools });
  assert.equal(created.type, 'session.create'); assert.equal(created.session.model, DOUBAO_VOICE_MODEL);
  assert.deepEqual(created.session.audio.input.format, { type: 'pcm', rate: 16000 });
  assert.deepEqual(created.session.audio.output.format, { type: 'pcm_s16le', rate: 24000 });
  assert.deepEqual(created.session.tools, tools); assert(!JSON.stringify(created).includes('API_KEY'));
  const [updated] = outgoing(protocol, { type: 'context', instructions: 'Verified current task: find the apple.' });
  assert.equal(updated.type, 'session.update'); assert.equal(updated.session.instructions, 'Verified current task: find the apple.'); assert.deepEqual(updated.session.tools, tools);
  assert.notEqual(created.event_id, updated.event_id);
  assert.deepEqual(protocol.parse({ type: 'session.created', session: { id: 'vendor-session' } }), [{ type: 'session_created', sessionId: 'vendor-session' }, { type: 'configured' }]);
  assert.deepEqual(protocol.parse({ type: 'session.updated' }), [{ type: 'configured' }]);
});

test('Doubao uses documented commit, mute, cancel and graceful close events', () => {
  const protocol = createDoubaoProtocol();
  const commands: VoiceCommand[] = [{ type: 'audio', audio: 'AAA=' }, { type: 'commit' }, { type: 'mute', muted: true }, { type: 'mute', muted: false }, { type: 'cancel' }, { type: 'close' }];
  const result = commands.flatMap(command => outgoing(protocol, command));
  assert.deepEqual(result.map(value => value.type), ['input_audio_buffer.append', 'input_audio_buffer.commit', 'input_audio_mute.commit', 'input_audio_unmute.commit', 'response.cancel', 'session.close']);
  assert.equal(result[0].audio, 'AAA=');
  assert.deepEqual(protocol.parse({ type: 'response.canceled' }), [{ type: 'response_done' }]);
  assert.deepEqual(protocol.parse({ type: 'session.closed' }), [{ type: 'closed' }]);
});

test('Doubao cumulative ASR replaces the current utterance and finalization preserves its identity', () => {
  const protocol = createDoubaoProtocol();
  assert.deepEqual(protocol.parse({ type: 'conversation.item.input_audio_transcription.started', item_id: 'child-1' }), [{ type: 'speech_start' }]);
  const first = protocol.parse({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'child-1', text: 'an' });
  const next = protocol.parse({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'child-1', text: 'an apple' });
  assert.deepEqual(first, [{ type: 'transcript', role: 'child', text: 'an', final: false, replace: true, itemId: 'child-1' }]);
  assert.deepEqual(next, [{ type: 'transcript', role: 'child', text: 'an apple', final: false, replace: true, itemId: 'child-1' }]);
  const done = protocol.parse({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'child-1', text: 'an apple' });
  assert.deepEqual(done, [{ type: 'transcript', role: 'child', text: 'an apple', final: true, replace: true, itemId: 'child-1' }, { type: 'speech_end' }]);
  const second = protocol.parse({ type: 'conversation.item.input_audio_transcription.delta', text: 'a banana' })[0];
  assert(second.type === 'transcript' && second.itemId !== 'child-1');
});

test('Doubao preserves teacher text deltas, accepts audio deltas and never invents usage seconds', () => {
  const protocol = createDoubaoProtocol();
  assert.deepEqual(protocol.parse({ type: 'response.output_audio.started' }), [{ type: 'response_start' }]);
  const a = protocol.parse({ type: 'response.output_text.delta', delta: 'Look at ' })[0];
  const b = protocol.parse({ type: 'response.output_text.delta', delta: 'the apple.' })[0];
  assert(a.type === 'transcript' && b.type === 'transcript' && a.itemId === b.itemId);
  assert.deepEqual(protocol.parse({ type: 'response.output_audio.delta', delta: 'AAAA' }), [{ type: 'audio', audio: 'AAAA', sampleRate: 24000 }]);
  assert.deepEqual(protocol.parse({ type: 'response.output_audio.delta', audio: 'AQABAA==' }), [{ type: 'audio', audio: 'AQABAA==', sampleRate: 24000 }]);
  const final = protocol.parse({ type: 'response.output_text.done', text: 'Look at the apple.' })[0];
  assert(final.type === 'transcript' && final.replace && final.final && final.text === 'Look at the apple.');
  assert.deepEqual(protocol.parse({ type: 'response.done', usage: { total_tokens: 1000 } }), [{ type: 'response_done' }]);
});

test('Doubao pairs every parallel tool result by call_id in the documented items envelope', () => {
  const protocol = createDoubaoProtocol();
  const calls = protocol.parse({ type: 'response.function_call_arguments.done', items: [{ call_id: 'call-1', name: 'highlight_objects', arguments: '{"objectIds":["apple"]}' }, { call_id: 'call-2', name: 'inspect_current_page', arguments: { question: 'What is selected?' } }] });
  assert.equal(calls.length, 2); assert(calls.every(call => call.type === 'tool'));
  assert.deepEqual(calls[0], { type: 'tool', callId: 'call-1', name: 'highlight_objects', arguments: '{"objectIds":["apple"]}' });
  const [result] = outgoing(protocol, { type: 'tool_result', callId: 'call-1', output: '{"status":"ok"}' });
  assert.equal(result.type, 'conversation.item.create');
  assert.deepEqual(result.items, [{ call_id: 'call-1', role: 'tool', content: [{ type: 'input_text', text: '{"status":"ok"}' }] }]);
});

test('Doubao literal speech cannot impersonate a text-query API or read control JSON aloud', () => {
  const protocol = createDoubaoProtocol();
  const [speech] = outgoing(protocol, { type: 'speak', text: 'Can you circle the apple?' });
  assert.equal(speech.type, 'speech_text_buffer.commit'); assert.equal(speech.text, 'Can you circle the apple?');
  const [control] = outgoing(protocol, { type: 'speak', text: 'Lead the current select exercise now. Rephrase the task.' });
  assert.equal(control.text, "Let's look at the picture. What can you see?");
  assert.throws(() => protocol.commands({ type: 'user_text', text: 'What does apple mean?' }), /文字问答/);
});

test('Doubao ignores malformed messages and suppresses upstream errors that can echo secrets', () => {
  const protocol = createDoubaoProtocol();
  for (const raw of ['not JSON', '[]', null, { type: 'unknown.event' }]) assert.deepEqual(protocol.parse(raw), []);
  const errors = protocol.parse(JSON.stringify({ type: 'error', status_code: 45000003, message: 'Authorization failed: some-sensitive-value', request: { context: 'private textbook' } }));
  assert.deepEqual(errors, [{ type: 'error', code: '45000003', message: '豆包实时语音返回错误，请检查服务开通、音色和服务端配置。' }]);
  assert(!JSON.stringify(errors).includes('some-sensitive-value')); assert(!JSON.stringify(errors).includes('private textbook'));
});
