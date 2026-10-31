import test from 'node:test';
import assert from 'node:assert/strict';
import { withRuntimeEnv, readRuntimeEnv } from '../lib/server/runtime-env.ts';
import { getConnectorBinding, runWithConnectorBinding } from '../lib/connector-context.ts';
import type { ConnectorBinding } from '../lib/connector-contract.mjs';

const fixtureName = 'TEEKO_RUNTIME_TEST_VALUE';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('runtime environment prefers request bindings and falls back outside the request', async () => {
  const previous = process.env[fixtureName];
  process.env[fixtureName] = 'process-fixture';
  try {
    assert.equal(readRuntimeEnv(fixtureName), 'process-fixture');
    await withRuntimeEnv({ [fixtureName]: 'request-fixture' }, async () => {
      assert.equal(readRuntimeEnv(fixtureName), 'request-fixture');
      await tick();
      assert.equal(readRuntimeEnv(fixtureName), 'request-fixture');
    });
    assert.equal(readRuntimeEnv(fixtureName), 'process-fixture');
    assert.equal(withRuntimeEnv({ [fixtureName]: '' }, () => readRuntimeEnv(fixtureName)), 'process-fixture');
    assert.equal(readRuntimeEnv('TEEKO_RUNTIME_TEST_MISSING'), undefined);
  } finally {
    if (previous === undefined) delete process.env[fixtureName];
    else process.env[fixtureName] = previous;
  }
});

test('concurrent asynchronous requests cannot read one another\'s runtime bindings', async () => {
  let releaseA!: () => void;
  const waiting = new Promise<void>(resolve => { releaseA = resolve; });
  const observed = { A: [] as string[], B: [] as string[] };
  await Promise.all([
    withRuntimeEnv({ requestName: 'A' }, async () => {
      observed.A.push(readRuntimeEnv('requestName')!);
      await waiting;
      await tick();
      observed.A.push(readRuntimeEnv('requestName')!);
    }),
    withRuntimeEnv({ requestName: 'B' }, async () => {
      await tick();
      observed.B.push(readRuntimeEnv('requestName')!);
      releaseA();
      await tick();
      observed.B.push(readRuntimeEnv('requestName')!);
    }),
  ]);
  assert.deepEqual(observed, { A: ['A', 'A'], B: ['B', 'B'] });
  assert.equal(readRuntimeEnv('requestName'), undefined);
});

test('nested bindings and scheduled callbacks retain their own request and connector context', async () => {
  const connector: ConnectorBinding = { invoke: async () => ({ status: 'binding_unavailable', message: 'Fixture binding unavailable.' }) };
  await runWithConnectorBinding(connector, () => withRuntimeEnv({ requestName: 'outer' }, async () => {
    await withRuntimeEnv({ requestName: 'inner' }, async () => {
      await tick();
      assert.equal(readRuntimeEnv('requestName'), 'inner');
      assert.equal(getConnectorBinding(), connector);
    });
    await tick();
    assert.equal(readRuntimeEnv('requestName'), 'outer');
    assert.equal(getConnectorBinding(), connector);
  }));
  assert.equal(getConnectorBinding(), undefined);
  assert.equal(readRuntimeEnv('requestName'), undefined);
});

test('relay configuration survives messages dispatched outside either request environment', async () => {
  const { captureRelayVoiceConfig } = await import('../lib/voice-server.ts');
  const previous = process.env.ZHIPU_API_KEY;
  process.env.ZHIPU_API_KEY = 'process-fallback-fixture';
  try {
    const first = withRuntimeEnv({ ZHIPU_API_KEY: 'request-A-fixture', GLM_REALTIME_MODEL: 'model-A' }, captureRelayVoiceConfig);
    const second = withRuntimeEnv({ ZHIPU_API_KEY: 'request-B-fixture', GLM_REALTIME_MODEL: 'model-B' }, captureRelayVoiceConfig);
    const firstSocket = new EventTarget(), secondSocket = new EventTarget();
    const messages: { key: string; model: string; outsideRequest: string | undefined }[] = [];
    firstSocket.addEventListener('message', () => messages.push({ ...first('glm'), outsideRequest: readRuntimeEnv('ZHIPU_API_KEY') }));
    secondSocket.addEventListener('message', () => messages.push({ ...second('glm'), outsideRequest: readRuntimeEnv('ZHIPU_API_KEY') }));
    await tick();
    secondSocket.dispatchEvent(new Event('message'));
    firstSocket.dispatchEvent(new Event('message'));
    assert.deepEqual(messages.map(({ key, model, outsideRequest }) => ({ key, model, outsideRequest })), [
      { key: 'request-B-fixture', model: 'model-B', outsideRequest: 'process-fallback-fixture' },
      { key: 'request-A-fixture', model: 'model-A', outsideRequest: 'process-fallback-fixture' },
    ]);
  } finally {
    if (previous === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = previous;
  }
});
