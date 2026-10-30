import test from 'node:test';
import assert from 'node:assert/strict';
import { LivePerformanceCollector, performanceReportCSV, performanceReportJSON, loadPerformanceReports, savePerformanceReport, clearPerformanceReports, type PerformanceStorage, type LivePerformanceReport } from '../lib/live-performance.ts';
const START = '2026-10-29T13:30:00.000Z';
function inbound(extra: Record<string, unknown> = {}) { return { id: 'inbound-a', type: 'inbound-rtp', kind: 'audio', ssrc: 123, timestamp: 1000, packetsReceived: 100, packetsLost: 5, bytesReceived: 1000, jitter: .01, jitterBufferDelay: 1, jitterBufferEmittedCount: 1000, totalSamplesReceived: 10000, concealedSamples: 100, concealmentEvents: 3, ...extra }; }
function collector() { let now = 0; const c = new LivePerformanceCollector({ now: () => now, startedAt: START }); return { c, at: (value: number) => { now = value; } }; }
test('selected transport RTT and interval-based audio metrics use W3C units', () => {
  const { c, at } = collector();
  const route = [{ type: 'transport', id: 'transport', selectedCandidatePairId: 'pair' }, { type: 'candidate-pair', id: 'pair', currentRoundTripTime: .08, localCandidateId: 'local', remoteCandidateId: 'remote' }, { type: 'local-candidate', id: 'local', candidateType: 'relay', protocol: 'udp', address: '192.0.2.10' }, { type: 'remote-candidate', id: 'remote', candidateType: 'host', address: '198.51.100.20' }];
  const first = c.sample([...route, inbound()]);
  assert.equal(first.rttMs, 80); assert.equal(first.inboundJitterMs, 10); assert.equal(first.jitterBufferMs, null); assert.equal(first.inboundPacketLossPct, null); assert.equal(first.route, 'relay');
  at(2000);
  const s = c.sample([...route, inbound({ timestamp: 3000, packetsReceived: 190, packetsLost: 15, bytesReceived: 5000, jitterBufferDelay: 3, jitterBufferEmittedCount: 2000, totalSamplesReceived: 20000, concealedSamples: 600, concealmentEvents: 6 }), { type: 'remote-inbound-rtp', kind: 'audio', roundTripTime: .1, fractionLost: .02 }]);
  assert.equal(s.intervalMs, 2000); assert.equal(s.inboundPacketLossPct, 10); assert.equal(s.jitterBufferMs, 2); assert.equal(s.concealmentPct, 5); assert.equal(s.concealmentEvents, 3); assert.equal(s.inboundKbps, 16); assert.equal(s.upstreamRttMs, 100); assert.equal(s.upstreamPacketLossPct, 2);
});
test('delayed packet recovery preserves signed cumulative loss and does not reset other deltas', () => {
  const { c, at } = collector(); c.sample([inbound({ packetsLost: 5 })]); at(1000);
  const s = c.sample([inbound({ timestamp: 2000, packetsReceived: 120, packetsLost: 2, bytesReceived: 2000, jitterBufferDelay: 1.5, jitterBufferEmittedCount: 1500 })]);
  assert.equal(s.inboundPacketsLost, 2); assert.equal(s.inboundPacketLossPct, 0); assert.equal(s.recoveredPackets, 3); assert.equal(s.jitterBufferMs, 1); assert.equal(s.inboundKbps, 8);
});
test('counter resets and changed SSRC start new baselines rather than generating false spikes', () => {
  const { c, at } = collector(); c.sample([inbound()]); at(1000);
  const reset = c.sample([inbound({ timestamp: 2000, packetsReceived: 1, packetsLost: 0, bytesReceived: 10, totalSamplesReceived: 100, concealedSamples: 0, concealmentEvents: 0 })]);
  assert.equal(reset.inboundPacketLossPct, null); assert.equal(reset.inboundKbps, null); assert.equal(reset.concealmentPct, null);
  at(2000); const changed = c.sample([inbound({ ssrc: 999, timestamp: 3000, packetsReceived: 5000, bytesReceived: 900000 })]);
  assert.equal(changed.inboundKbps, null); assert.equal(changed.recoveredPackets, null);
});
test('multiple streams aggregate counters and weight jitter-buffer delay by emitted samples', () => {
  const { c, at } = collector(); c.sample([inbound(), inbound({ id: 'inbound-b', ssrc: 456 })]); at(1000);
  const s = c.sample([inbound({ timestamp: 2000, packetsReceived: 110, packetsLost: 6, bytesReceived: 2000, jitterBufferDelay: 2, jitterBufferEmittedCount: 2000 }), inbound({ id: 'inbound-b', ssrc: 456, timestamp: 2000, packetsReceived: 120, packetsLost: 7, bytesReceived: 3000, jitterBufferDelay: 7, jitterBufferEmittedCount: 4000 })]);
  assert.equal(s.inboundPacketsReceived, 230); assert.equal(s.inboundPacketsLost, 13); assert.equal(s.inboundKbps, 24); assert.equal(s.jitterBufferMs, 1.75); assert(Math.abs(s.inboundPacketLossPct! - 100 * 3 / 33) < .000001);
});
test('unsupported and absent metrics stay null and an unselected pair is not guessed', () => {
  const { c, at } = collector();
  const first = c.sample([{ type: 'candidate-pair', id: 'not-selected', currentRoundTripTime: .4 }, { id: 'minimal', type: 'inbound-rtp', kind: 'audio', timestamp: 0 }]);
  at(1000); const s = c.sample([{ id: 'minimal', type: 'inbound-rtp', kind: 'audio', timestamp: 1000 }]);
  assert.equal(first.rttMs, null);
  for (const value of [s.inboundJitterMs, s.inboundKbps, s.inboundPacketLossPct, s.concealmentPct, s.playoutSynthesizedMs]) assert.equal(value, null);
});
test('playout synthesis is an interval metric and Map-style RTCStatsReports are accepted', () => {
  const { c, at } = collector(); c.sample(new Map([['playout', { id: 'playout', type: 'media-playout', synthesizedSamplesDuration: .1 }]])); at(2000);
  const s = c.sample(new Map([['playout', { id: 'playout', type: 'media-playout', synthesizedSamplesDuration: .125 }]]));
  assert(Math.abs(s.playoutSynthesizedMs! - 25) < .000001);
});
test('bounded report calculates distributions, preserves strategy changes and only accepts known labels', () => {
  const { c, at } = collector(); c.measure('agent_http', 100); c.measure('agent_http', 200); c.measure('agent_http', 900); c.markUserStutter();
  assert.deepEqual(c.summary().measurements.agent_http, { count: 3, p50Ms: 200, p95Ms: 900, maxMs: 900 }); assert.equal(c.summary().stutterMarkers, 1);
  c.setStrategy('network_a'); c.sample([]); c.setStrategy('sk-private-secret'); c.sample([]);
  assert.equal(c.report().samples[0].strategy, 'network_a'); assert.equal(c.report().samples[1].strategy, 'baseline');
  for (let n = 0; n < 450; n++) { at(n * 2000); c.sample([]); c.measure('event_loop_lag', n); }
  const report = c.report(); assert.equal(report.samples.length, 400); assert.equal(report.events.length, 400); assert.equal(report.startedAt, START);
  const copy = c.report(); copy.samples[0].rttMs = 999; assert.equal(c.report().samples[0].rttMs, null);
});
test('exports allowlist fields and never leak candidate addresses, credentials or modified storage payloads', () => {
  const { c } = collector(); c.sample([inbound({ transcript: 'private child words', apiKey: 'sk-private', address: '192.0.2.3' })]); c.measure('session_http', 300); c.markUserStutter();
  const tampered = { ...c.report(), secret: 'sk-private', caveats: ['private child words'], events: [...c.report().events, { type: 'measure', atMs: 0, name: '=HYPERLINK(secret)', durationMs: 10 }], samples: c.report().samples.map(s => ({ ...s, address: '192.0.2.3', strategy: '=HYPERLINK(secret)' })) } as unknown as LivePerformanceReport;
  for (const exported of [performanceReportJSON(tampered), performanceReportCSV(tampered)]) {
    assert(!/sk-private|private child words|192\.0\.2\.3|HYPERLINK/.test(exported));
  }
  assert(performanceReportCSV(tampered).includes('started_at_utc')); assert(performanceReportCSV(tampered).includes('user_stutter')); assert(performanceReportJSON(tampered).includes('not counted as freezes'));
});
test('last three local reports are bounded, updated by session timestamp and storage failures are harmless', () => {
  let value: string | null = null; const storage: PerformanceStorage = { getItem: () => value, setItem: (_, v) => { value = v; }, removeItem: () => { value = null; } };
  for (let n = 0; n < 4; n++) { const c = new LivePerformanceCollector({ startedAt: `2026-10-29T13:30:0${n}.000Z` }); c.markUserStutter(); assert(savePerformanceReport(c.report(), storage)); }
  assert.equal(loadPerformanceReports(storage).length, 3); const latest = loadPerformanceReports(storage)[0]; assert(savePerformanceReport(latest, storage)); assert.equal(loadPerformanceReports(storage).length, 3);
  assert(clearPerformanceReports(storage)); assert.deepEqual(loadPerformanceReports(storage), []);
  const broken: PerformanceStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadPerformanceReports(broken), []); assert.equal(savePerformanceReport(latest, broken), false); assert.equal(clearPerformanceReports(broken), false);
});

test('one known candidate cannot prove that the selected media route is non-relayed',()=>{
 const c=new LivePerformanceCollector();const s=c.sample([{type:'transport',id:'t',selectedCandidatePairId:'p'},{type:'candidate-pair',id:'p',localCandidateId:'l',remoteCandidateId:'missing'},{type:'local-candidate',id:'l',candidateType:'host',protocol:'udp'}]);assert.equal(s.route,null);
});

test('closed-session exports freeze duration and ignore late asynchronous measurements',()=>{
 const {c,at}=collector();at(1000);c.measure('agent_http',300);c.finish();at(10000);c.measure('agent_http',8000);assert.equal(c.report().durationMs,1000);assert.equal(c.summary().measurements.agent_http?.count,1);
});
