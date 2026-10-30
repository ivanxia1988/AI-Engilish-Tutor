import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNetwork, classifyNetwork, mediaPoor } from '../lib/network-check.ts';
import { GET } from '../app/api/network-check/route.ts';
import type { LivePerformanceSample } from '../lib/live-performance.ts';
const ok = () => Response.json({ ok: true, kind: 'littleleaf-network-probe' });

test('network warning uses latency, variation and failures without trusting the online hint', () => {
  assert.equal(classifyNetwork([{ durationMs: 100 }, { durationMs: 120 }, { durationMs: 110 }], false).status, 'good');
  assert.equal(classifyNetwork([{ durationMs: 900 }, { durationMs: 1000 }, { durationMs: 1100 }]).status, 'poor');
  assert.equal(classifyNetwork([{ durationMs: 100 }, { durationMs: 110 }, { durationMs: 800 }]).status, 'poor');
  assert.equal(classifyNetwork([{ durationMs: 100 }, { durationMs: null }, { durationMs: 110 }]).status, 'poor');
  assert.equal(classifyNetwork([{ durationMs: null }]).status, 'unavailable');
  assert.equal(classifyNetwork([{ durationMs: null }], false).status, 'offline');
  assert.equal(classifyNetwork([{ durationMs: NaN }, { durationMs: -1 }]).medianMs, null);
});
test('startup probes are sequential, same-origin, uncached and validate the complete response', async () => {
  let active = 0, maxActive = 0, time = 0; const urls: string[] = [];
  const fake: typeof fetch = async (url, init) => {
    urls.push(String(url)); active++; maxActive = Math.max(maxActive, active);
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.redirect, 'error');
    await Promise.resolve(); time += 100; active--; return ok();
  };
  const result = await checkNetwork({ fetch: fake, now: () => time, onlineHint: false });
  assert.equal(maxActive, 1); assert.equal(urls.length, 3); assert(urls.every(url => url.startsWith('/api/network-check?')));
  assert.equal(result.status, 'good'); assert.equal(result.medianMs, 100);
});
test('HTTP errors, captive HTML and unexpected JSON never become a healthy network result', async () => {
  for (const response of [new Response('Unavailable', { status: 503 }), new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }), Response.json({ ok: true }), Response.json({ ok: true, kind: 'littleleaf-network-probe', unexpected: true })]) {
    const result = await checkNetwork({ fetch: async () => response.clone() }); assert.equal(result.status, 'unavailable'); assert.equal(result.succeeded, 0);
  }
});
test('probe timeout is bounded even when fetch ignores cancellation', async () => {
  let calls = 0;
  const result = await checkNetwork({ timeoutMs: 2, fetch: () => { calls++; return new Promise<Response>(() => {}); } });
  assert.equal(calls, 3); assert.equal(result.status, 'unavailable');
});
test('external cancellation aborts the request and stops all further probes', async () => {
  const controller = new AbortController(); let calls = 0, received: AbortSignal | null | undefined;
  const running = checkNetwork({ signal: controller.signal, fetch: async (_, init) => { calls++; received = init?.signal; return await new Promise<Response>(() => {}); } });
  controller.abort(); await assert.rejects(running, error => error instanceof DOMException && error.name === 'AbortError');
  assert.equal(calls, 1); assert.equal(received?.aborted, true);
  await assert.rejects(checkNetwork({ signal: controller.signal, fetch: async () => { throw new Error('must not fetch'); } }), error => error instanceof DOMException && error.name === 'AbortError');
});
test('media warnings ignore unavailable fields and use conservative quality thresholds', () => {
  assert.equal(mediaPoor(null), false);
  assert.equal(mediaPoor({ rttMs: null, inboundJitterMs: null, jitterBufferMs: null, inboundPacketLossPct: null, concealmentPct: null } as LivePerformanceSample), false);
  for (const [key, value] of [['rttMs', 650], ['inboundJitterMs', 90], ['jitterBufferMs', 350], ['inboundPacketLossPct', 6], ['concealmentPct', 4]] as const) assert(mediaPoor({ [key]: value } as unknown as LivePerformanceSample));
});
test('public probe endpoint has no authentication dependency and forbids caching', async () => {
  const response = await GET(); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.deepEqual(await response.json(), { ok: true, kind: 'littleleaf-network-probe' });
});
