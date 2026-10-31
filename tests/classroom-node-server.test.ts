import assert from 'node:assert/strict';
import test from 'node:test';
import { startNodeClassroomServer } from '../scripts/serve-node.mjs';

test('Node entry forwards HTTP through Next, listens on requested port and closes resources', async () => {
  let prepared = 0, closed = 0;
  const instance = await startNodeClassroomServer({
    port: 0, hostname: '127.0.0.1', origin: 'http://127.0.0.1:8080',
    app: { async prepare() { prepared++; }, getRequestHandler() { return async (_request: unknown, response: { end(value: string): void }) => response.end('next-http'); }, async close() { closed++; } },
    open: async () => { throw new Error('Anonymous test never opens a voice lease.'); },
  });
  try {
    const address = instance.server.address(); assert(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(await response.text(), 'next-http'); assert.equal(prepared, 1);
  } finally { await instance.close(); }
  assert.equal(closed, 1); assert.equal(instance.server.listening, false);
});

test('Node startup validates origin before creating an application or listener', async () => {
  await assert.rejects(startNodeClassroomServer({ port: 0, origin: 'https://teeko.app/path' }), /origin/i);
});
