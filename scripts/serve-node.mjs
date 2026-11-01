import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { attachClassroomSockets } from '../lib/server/classroom-sockets.ts';

/** Next owns HTTP; the classroom adapter alone owns authenticated application upgrades. */
export async function startNodeClassroomServer(options = {}) {
  const origin = options.origin ?? process.env.APP_ORIGIN;
  if (!origin || new URL(origin).origin !== origin) throw new Error('A valid APP_ORIGIN origin is required.');
  const administratorOrigin = options.adminOrigin ?? process.env.ADMIN_ORIGIN;
  if (administratorOrigin && new URL(administratorOrigin).origin !== administratorOrigin) throw new Error('A valid ADMIN_ORIGIN origin is required.');
  const administratorHost = administratorOrigin ? new URL(administratorOrigin).host : undefined;
  const port = options.port ?? Number(process.env.PORT || '8080');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid server port.');
  const hostname = options.hostname ?? '0.0.0.0';
  const app = options.app ?? (await import('next')).default({ dev: false, hostname, port });
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = createServer({ maxHeaderSize: 16384 }, (request, response) => {
    if (administratorOrigin && administratorOrigin !== origin && request.headers.host === administratorHost) {
      let pathname;
      try { pathname = new URL(request.url ?? '/', administratorOrigin).pathname; }
      catch { response.writeHead(400); response.end('Invalid request target.'); return; }
      if (pathname === '/') {
        response.writeHead(307, { Location: '/admin', 'Cache-Control': 'no-store' }); response.end(); return;
      }
    }
    void Promise.resolve().then(() => handler(request, response)).catch(() => {
      if (!response.headersSent) { response.statusCode = 500; response.end('The request could not be completed.'); }
      else response.destroy();
    });
  });
  const open = options.open ?? (await import('../lib/server/classroom-runtime.ts')).openClassroomVoice;
  const sockets = attachClassroomSockets(server, { ...options.socketOptions, origin, open });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, () => { server.off('error', reject); resolve(); });
  }).catch(async error => { await sockets.close(); await app.close?.(); throw error; });
  let closing;
  return {
    server,
    close() {
      closing ??= (async () => {
        await sockets.close();
        const stopped = new Promise(resolve => server.close(resolve));
        server.closeAllConnections(); await stopped;
        await app.close?.();
      })();
      return closing;
    },
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.env.NODE_ENV = 'production'; process.env.TEEKO_NODE_RUNTIME = '1'; process.env.NEXT_TELEMETRY_DISABLED = '1';
  try {
    const instance = await startNodeClassroomServer();
    console.log(`Teeko Node server listening on port ${process.env.PORT || '8080'}.`);
    let stopping = false;
    const shutdown = () => {
      if (stopping) return; stopping = true;
      const force = setTimeout(() => process.exit(1), 12000); force.unref();
      void instance.close().then(() => process.exit(0), () => process.exit(1));
    };
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  } catch {
    console.error('Unable to start the Teeko Node server. Check service configuration and build output.'); process.exitCode = 1;
  }
}
