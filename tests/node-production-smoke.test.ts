import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access } from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const runner = fileURLToPath(new URL('../scripts/run-node-framework.mjs', import.meta.url));

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

test('Node production serves local HTTP and rejects anonymous or forged Sites identities', {
  skip: process.env.TEEKO_NODE_SMOKE !== '1' ? 'Run explicitly after build:node with TEEKO_NODE_SMOKE=1.' : false,
  timeout: 30_000,
}, async t => {
  await access(new URL('../.next-node/BUILD_ID', import.meta.url));
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [runner, 'start'], {
    cwd: project,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, PORT: String(port), OPENAI_API_KEY: '', OPENAI_CHILD_DATA_READY: 'false', DASHSCOPE_API_KEY: '', VOLCENGINE_VOICE_API_KEY: '', ZHIPU_API_KEY: '' },
  });
  let spawnError = false;
  child.on('error', () => { spawnError = true; });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    const deadline = delay(2000, 'timeout', { ref: false });
    if (await Promise.race([stopped, deadline]) === 'timeout') {
      child.kill('SIGKILL');
      await stopped;
    }
  };
  t.after(stop);
  const deadline = Date.now() + 20_000;
  let reachable = false;
  while (Date.now() < deadline) {
    assert(!spawnError && child.exitCode === null && child.signalCode === null, 'Node production process exited before readiness.');
    try {
      const response = await fetch(`${origin}/api/network-check`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { reachable = true; break; }
    } catch {}
    await delay(50);
  }
  assert(reachable, 'Node production HTTP did not become ready.');
  const network = await fetch(`${origin}/api/network-check`);
  assert.equal(network.status, 200);
  assert.deepEqual(await network.json(), { ok: true, kind: 'littleleaf-network-probe' });
  const page = await fetch(`${origin}/prototype`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Teeko/);
  const forged = { 'oai-authenticated-user-id': 'local-forged-user', 'oai-authenticated-user-email': 'fixture@example.test' };
  for (const headers of [{}, forged]) {
    const status = await fetch(`${origin}/api/status`, { headers });
    assert.equal(status.status, 200);
    const statusBody = await status.json() as { signedIn?: unknown };
    assert.equal(statusBody.signedIn, false);
    const teacher = await fetch(`${origin}/api/teacher`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(teacher.status, 401);
    const teacherBody = await teacher.json() as { error?: unknown };
    assert(typeof teacherBody.error === 'string');
    assert.match(teacherBody.error, /登录/);
  }
  await stop();
  const released = createServer();
  released.listen(port, '127.0.0.1');
  await once(released, 'listening');
  await new Promise<void>((resolve, reject) => released.close(error => error ? reject(error) : resolve()));
  t.diagnostic(`HTTP 200: /prototype, /api/network-check, /api/status; HTTP 401: anonymous and forged Sites /api/teacher; port ${port} released and rebound after shutdown.`);
});
