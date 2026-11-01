import assert from 'node:assert/strict';
import test from 'node:test';
import { startNodeClassroomServer } from '../scripts/serve-node.mjs';
import { createServer,request as requestHttp } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import type { ClassroomSnapshot } from '../lib/classroom-contract';

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
test('dedicated admin hostname root redirects to the guarded admin site without replacing the product homepage',async()=>{
 const instance=await startNodeClassroomServer({port:0,hostname:'127.0.0.1',origin:'https://teeko.app',adminOrigin:'https://admin.teeko.app',app:{async prepare(){},async close(){},getRequestHandler(){return async(_request:unknown,response:{end(value:string):void})=>response.end('product-page');}},open:async()=>{throw new Error('No media expected');}});
 try{const address=instance.server.address();assert(address&&typeof address!=='string');
  const root=`http://127.0.0.1:${address.port}/`;
  const get=(host:string)=>new Promise<{status:number;location:string|undefined;body:string}>((resolve,reject)=>{const req=requestHttp(root,{headers:{host}},response=>{let body='';response.on('data',chunk=>{body+=chunk;});response.on('end',()=>resolve({status:response.statusCode??0,location:response.headers.location,body}));});req.on('error',reject);req.end();});
  const admin=await get('admin.teeko.app');assert.equal(admin.status,307);assert.equal(admin.location,'/admin');
  const product=await get('teeko.app');assert.equal(product.status,200);assert.equal(product.body,'product-page');
 }finally{await instance.close();}
});

test('malformed admin request targets return 400 and leave the Node server available', async () => {
  const instance = await startNodeClassroomServer({
    port: 0, hostname: '127.0.0.1', origin: 'https://teeko.app', adminOrigin: 'https://admin.teeko.app',
    app: { async prepare() {}, async close() {}, getRequestHandler() { return async (_request: unknown, response: { end(value: string): void }) => response.end('healthy'); } },
    open: async () => { throw new Error('No media expected'); },
  });
  try {
    const address = instance.server.address(); assert(address && typeof address !== 'string');
    const response = await new Promise<number>((resolve, reject) => {
      const request = requestHttp({ hostname: '127.0.0.1', port: address.port, path: 'http://[', headers: { host: 'admin.teeko.app' } }, result => {
        result.resume(); result.on('end', () => resolve(result.statusCode ?? 0));
      });
      request.on('error', reject); request.end();
    });
    assert.equal(response, 400);
    assert.equal(await (await fetch(`http://127.0.0.1:${address.port}/`)).text(), 'healthy');
  } finally { await instance.close(); }
});

test('HTTP-first Next upgrade installation cannot close the separate application voice namespace', async () => {
  const vendorHttp = createServer(), vendor = new WebSocketServer({ server: vendorHttp });
  vendor.on('connection', socket => {
    socket.on('message', data => {
      const event = JSON.parse(data.toString());
      if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'response.create') { socket.send(JSON.stringify({ type: 'response.created' })); socket.send(JSON.stringify({ type: 'response.done' })); }
    });
    socket.send(JSON.stringify({ type: 'session.created', session: { id: 'fixture-voice-session' } }));
  });
  vendorHttp.listen(0, '127.0.0.1'); await once(vendorHttp, 'listening');
  const vendorAddress = vendorHttp.address(); assert(vendorAddress && typeof vendorAddress !== 'string');
  const id = '6e98bb60-4ed0-4c64-bcbc-174d5dcb26c2'; let upgradeInstalled = false, claimed = 0;
  const snapshot = { id, revision: 1, stepIndex: 0, connectionEpoch: 1 } as ClassroomSnapshot;
  const instance = await startNodeClassroomServer({
    port: 0, hostname: '127.0.0.1', origin: 'http://localhost:8080',
    app: {
      async prepare() {}, async close() {},
      getRequestHandler() { return async (_request: unknown, response: { end(value: string): void }) => {
        if (!upgradeInstalled) {
          upgradeInstalled = true;
          // Next lazily installs its own app-route upgrade handler on first HTTP.
          instance.server.on('upgrade', (request, socket) => { if (request.url?.startsWith('/api/v1/')) socket.end(); });
        }
        response.end('HTTP ready');
      }; },
    },
    open: async () => {
      claimed++;
      return { id, epoch: 1, provider: 'qwen', instructions: 'Teach the current picture.', initialCue: 'Find the apple.', remainingMs: 60000, snapshot,
        async heartbeat() { return { snapshot, instructions: 'Teach the current picture.' }; }, async transcript() {}, async tool() { return { snapshot, output: { status: 'unavailable' } }; }, async closed() {} };
    },
    socketOptions: {
      config: () => ({ key: 'fixture-key', model: 'qwen3.8-omni-flash-realtime', voice: 'Tina', workspaceId: 'fixture-workspace', region: 'cn-beijing' }),
      connect: () => new WebSocket(`ws://127.0.0.1:${vendorAddress.port}`),
    },
  });
  try {
    const address = instance.server.address(); assert(address && typeof address !== 'string');
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/login`)).status, 200); assert(upgradeInstalled);
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/classrooms/${id}`, { headers: { Origin: 'http://localhost:8080', Cookie: `teeko_session=${'s'.repeat(43)}` } });
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Voice ready did not arrive after HTTP setup.')), 2000);
      socket.on('message', data => { if (JSON.parse(data.toString()).type === 'ready') { clearTimeout(timeout); resolve(); } });
      socket.on('error', error => { clearTimeout(timeout); reject(error); });
    });
    await ready; assert.equal(claimed, 1); assert.equal(socket.readyState, WebSocket.OPEN);
    socket.send(JSON.stringify({ type: 'close' })); await once(socket, 'close');
  } finally {
    await instance.close(); for (const socket of vendor.clients) socket.terminate();
    await new Promise<void>(resolve => vendor.close(() => resolve())); await new Promise<void>(resolve => vendorHttp.close(() => resolve()));
  }
});
