import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerTimer } from '../lib/server-timing.ts';

test('upstream duration covers the complete asynchronous body-read work', async () => {
  let now = 100;
  const timer = new ServerTimer('agent', () => now);
  now = 112; // Authorization/validation before contacting the provider.
  const value = await timer.upstream(async () => {
    now = 160; // Response headers have arrived.
    await Promise.resolve();
    now = 187; // Body has finished reading.
    return { complete: true };
  });
  now = 194; // Application validates and prepares the returned response.
  assert.deepEqual(value, { complete: true });
  assert.deepEqual(timer.snapshot('synthetic-model'), { serverTotalMs: 94, upstreamMs: 75, model: 'synthetic-model' });
});

test('failure keeps the original response and still reports elapsed timing without request data', async () => {
  let now = 0;
  const timer = new ServerTimer('teacher', () => now);
  await assert.rejects(timer.upstream(async () => { now = 52.34; throw new Error('synthetic failure'); }));
  now = 55.67;
  const entries: string[] = [], originalInfo = console.info;
  console.info = (value: string) => { entries.push(value); };
  let response: Response;
  try { response = timer.error(Response.json({ error: 'Try again.' }, { status: 502 }), 'synthetic-model'); }
  finally { console.info = originalInfo; }
  assert.equal(response!.status, 502);
  assert.deepEqual(await response!.json(), { error: 'Try again.' });
  assert.equal(response!.headers.get('server-timing'), 'app;dur=55.7, upstream;dur=52.3');
  assert.equal(response!.headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(entries[0]), { scope: 'littleleaf.performance', operation: 'teacher', status: 502, totalMs: 55.7, upstreamMs: 52.3, model: 'synthetic-model' });
  assert(!entries[0].includes('synthetic failure'));
});

test('timing callback supports existing structured-response callers and ignores invalid duration samples', () => {
  let now = 10;
  const timer = new ServerTimer('session', () => now);
  timer.recordUpstream(15.12); timer.recordUpstream(-7); timer.recordUpstream(NaN); timer.recordUpstream(Infinity);
  now = 30;
  assert.deepEqual(timer.snapshot(), { serverTotalMs: 20, upstreamMs: 15.1 });
});
