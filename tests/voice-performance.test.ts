import test from 'node:test';
import assert from 'node:assert/strict';
import { LivePerformanceCollector, performanceReportJSON, performanceReportCSV, loadPerformanceReports, savePerformanceReport, type LivePerformanceReport, type PerformanceStorage } from '../lib/live-performance';
import { VOICE_PROVIDER_IDS, VOICE_PROVIDERS, type VoiceTransportKind } from '../lib/voice-provider';

const startedAt = '2026-10-29T15:00:00.000Z';
function storage(initial: unknown[] = []) {
  let value: string | null = JSON.stringify(initial);
  const memory: PerformanceStorage = { getItem: () => value, setItem: (_key, text) => { value = text; }, removeItem: () => { value = null; } };
  return memory;
}
function csvRecords(text: string) {
  const [header, ...lines] = text.split('\n').map(line => line.split(','));
  return lines.map(line => Object.fromEntries(header.map((field, index) => [field, line[index]])));
}

test('voice performance JSON and every CSV row preserve each provider and its actual transport', () => {
  const models = { openai: 'gpt-live-1', qwen: 'qwen3.8-omni-flash-realtime', doubao: '1.2.6.1', glm: 'glm-realtime-flash' };
  for (const provider of VOICE_PROVIDER_IDS) {
    let now = 0;
    const transport = VOICE_PROVIDERS[provider].transport;
    const collector = new LivePerformanceCollector({ now: () => now, provider, startedAt });
    collector.setModel(models[provider]);
    collector.sample([]); now = 1500; collector.measure('first_teacher_audio', 1500); collector.markUserStutter();
    const exported = JSON.parse(performanceReportJSON(collector.report()));
    assert.equal(exported.provider, provider); assert.equal(exported.transport, transport);
    assert.equal(exported.model, models[provider]);
    assert.equal(exported.summary.measurements.first_teacher_audio.p50Ms, 1500);
    const rows = csvRecords(performanceReportCSV(collector.report()));
    assert.equal(rows.length, 3); assert(rows.every(row => row.provider === provider && row.transport === transport && row.model === models[provider]));
    const memory = storage(); assert(savePerformanceReport(collector.report(), memory));
    assert.equal(loadPerformanceReports(memory)[0].provider, provider); assert.equal(loadPerformanceReports(memory)[0].transport, transport);
    assert.equal(loadPerformanceReports(memory)[0].model, models[provider]);
  }
});

test('explicit transport metadata is retained rather than guessed from the vendor name', () => {
  const transport: VoiceTransportKind = 'websocket_relay';
  const collector = new LivePerformanceCollector({ provider: 'qwen', transport, startedAt });
  collector.measure('session_http', 250);
  assert.equal(JSON.parse(performanceReportJSON(collector.report())).transport, transport);
  assert.equal(csvRecords(performanceReportCSV(collector.report()))[0].transport, transport);
});

test('WebSocket ping and playback queue stay separate from unavailable WebRTC loss and RTT metrics', () => {
  let now = 0;
  const collector = new LivePerformanceCollector({ now: () => now, provider: 'doubao', startedAt });
  collector.sample([]); now = 2000; collector.sample([]);
  collector.measure('websocket_ping', 43); collector.measure('playback_queue', 0); collector.measure('playback_queue', 140);
  const report = JSON.parse(performanceReportJSON(collector.report()));
  assert.equal(report.summary.measurements.websocket_ping.p50Ms, 43);
  assert.equal(report.summary.measurements.playback_queue.count, 2);
  assert.equal(report.summary.measurements.playback_queue.p50Ms, 0, 'measured zero queue must stay zero');
  for (const sample of report.samples) for (const field of ['rttMs', 'inboundPacketLossPct', 'inboundJitterMs', 'jitterBufferMs', 'concealmentPct', 'inboundKbps']) assert.equal(sample[field], null);
  const rows = csvRecords(performanceReportCSV(collector.report()));
  for (const row of rows.filter(row => row.record_type === 'sample')) assert.equal(row.inboundPacketLossPct, '');
  assert.equal(rows.find(row => row.name === 'websocket_ping')?.duration_ms, '43');
});

test('provider-aware exports and local storage never retain injected keys, audio, transcript, addresses or arbitrary metadata', () => {
  const collector = new LivePerformanceCollector({ provider: 'glm', startedAt }); collector.sample([]); collector.measure('websocket_ping', 50);
  const privateText = 'private_child_utterance_value', secret = 'private_provider_credential_value', audio = 'private_audio_payload_value';
  const unsafe = {
    ...collector.report(), secret, apiKey: secret, audio, transcript: privateText, websocketUrl: 'wss://private-host.invalid?token=private_provider_credential_value', caveats: [privateText],
    samples: collector.report().samples.map(sample => ({ ...sample, token: secret, audio, transcript: privateText, candidate: '192.0.2.99' })),
    events: [...collector.report().events.map(event => ({ ...event, apiKey: secret, body: audio })), { type: 'measure', atMs: 0, strategy: 'baseline', name: '=HYPERLINK(private_provider_credential_value)', durationMs: 1 }],
  } as unknown as LivePerformanceReport;
  const memory = storage(); assert(savePerformanceReport(unsafe, memory));
  for (const output of [performanceReportJSON(unsafe), performanceReportCSV(unsafe), JSON.stringify(loadPerformanceReports(memory))]) {
    for (const text of [privateText, secret, audio, '192.0.2.99', 'private-host', 'HYPERLINK']) assert(!output.includes(text));
    assert(output.includes('glm')); assert(output.includes('websocket_relay'));
  }
});

test('legacy schema-one reports without provider or transport load as the original GPT WebRTC sessions', () => {
  const collector = new LivePerformanceCollector({ startedAt }); collector.sample([]); collector.measure('session_http', 321);
  const legacy = collector.report(); delete legacy.provider; delete legacy.transport;
  const report = loadPerformanceReports(storage([legacy]))[0];
  assert.equal(report.schemaVersion, 1); assert.equal(report.provider, 'openai'); assert.equal(report.transport, 'webrtc_direct');
  assert.equal(report.samples.length, 1); assert.equal(report.samples[0].rttMs, null);
  assert.equal(report.summary.measurements.session_http?.p50Ms, 321);
  const exported = JSON.parse(performanceReportJSON(legacy)); assert.equal(exported.provider, 'openai'); assert.equal(exported.transport, 'webrtc_direct');
});

test('unknown provider and transport strings cannot become export formulas or browser credentials', () => {
  const collector = new LivePerformanceCollector({ startedAt }); collector.sample([]);
  const report = { ...collector.report(), provider: '=HYPERLINK(secret)', transport: 'wss://example.invalid?api_key=secret' } as unknown as LivePerformanceReport;
  for (const output of [performanceReportJSON(report), performanceReportCSV(report)]) {
    assert(!/HYPERLINK|example\.invalid|api_key/.test(output)); assert(output.includes('openai')); assert(output.includes('webrtc_direct'));
  }
});

test('unrecognized or credential-like model metadata never survives setters, exports or stored reports', () => {
  const collector = new LivePerformanceCollector({ provider: 'qwen', startedAt }); collector.sample([]);
  collector.setModel('qwen3.8-omni-flash-realtime'); assert.equal(collector.report().model, 'qwen3.8-omni-flash-realtime');
  for (const model of ['sk-proj-sensitive-credential', '=HYPERLINK(secret)', 'arbitrary private note', 'Bearer sensitive-credential', 'https://provider.invalid?key=secret', 'qwen' + 'a'.repeat(101)]) {
    collector.setModel(model); assert.equal(collector.report().model, undefined, 'invalid updates must clear any stale requested model');
    const unsafe = { ...collector.report(), model };
    const output = JSON.parse(performanceReportJSON(unsafe)); assert.equal(output.model, undefined);
    assert.equal(csvRecords(performanceReportCSV(unsafe))[0].model, '');
    assert.equal(loadPerformanceReports(storage([unsafe]))[0].model, undefined);
  }
});
