const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');
const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const WebSocket = require('ws');

const SERVER_PATH = path.join(__dirname, 'server.cjs');

test('health and readiness stay available through graceful shutdown', async (t) => {
  const running = await startServer(false);
  t.after(() => stopIfRunning(running.child));

  const health = await fetch(`http://127.0.0.1:${running.port}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');

  const ready = await fetch(`http://127.0.0.1:${running.port}/readyz`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).status, 'ready');

  running.child.kill('SIGTERM');
  const [code, signal] = await once(running.child, 'exit');
  assert.equal(code, 0, running.output());
  assert.equal(signal, null);
});

test('production readiness fails closed when required Redis is unavailable', async (t) => {
  const running = await startServer(true);
  t.after(() => stopIfRunning(running.child));

  const ready = await fetch(`http://127.0.0.1:${running.port}/readyz`);
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), {
    status: 'not_ready',
    redisRequired: true,
    redisAvailable: false,
    redisPubSubAvailable: false
  });

  running.child.kill('SIGTERM');
  const [code] = await once(running.child, 'exit');
  assert.equal(code, 0, running.output());
});

test('clients that connect during slow hydration still receive the stored document', async (t) => {
  const backend = await startMockBackend({ snapshotDelayMs: 300, plainText: 'hello from postgres' });
  t.after(() => {
    backend.server.closeAllConnections();
    backend.server.close();
  });
  const running = await startServer(false, backend.env);
  t.after(() => stopIfRunning(running.child));

  const docPath = 'ROOM01/11111111-1111-4111-8111-111111111111';
  const first = connectClient(running.port, docPath);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = connectClient(running.port, docPath);
  t.after(() => {
    first.close();
    second.close();
  });

  assert.equal(await first.synced, 'hello from postgres', running.output());
  assert.equal(await second.synced, 'hello from postgres', running.output());
  assert.equal(backend.snapshotReads(), 1);
});

function connectClient(port, docPath) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://127.0.0.1:${port}`, docPath, doc, {
    WebSocketPolyfill: WebSocket,
    params: { access_token: 'token' }
  });
  const synced = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('client did not sync')), 4_000);
    provider.on('sync', (isSynced) => {
      if (isSynced) {
        clearTimeout(timer);
        resolve(doc.getText('monaco').toString());
      }
    });
  });
  const close = () => {
    provider.destroy();
    provider.awareness.destroy();
    doc.destroy();
  };
  return { close, synced };
}

async function startMockBackend({ snapshotDelayMs, plainText }) {
  let reads = 0;
  const server = http.createServer((req, res) => {
    const send = (body) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url.startsWith('/internal/auth/realtime/validate')) {
      send({ valid: true, userId: 'user-1' });
    } else if (req.method === 'GET' && req.url.includes('/snapshot')) {
      reads += 1;
      setTimeout(() => send({ encodedState: '', plainText }), snapshotDelayMs);
    } else {
      send({});
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    snapshotReads: () => reads,
    env: {
      AUTH_VALIDATION_ENDPOINT: `${origin}/internal/auth/realtime/validate`,
      SNAPSHOT_ENDPOINT: `${origin}/internal/files`,
      ROOM_CLEANUP_ENDPOINT: `${origin}/internal/rooms`
    }
  };
}

async function startServer(requireRedis, extraEnv = {}) {
  const port = await availablePort();
  let logs = '';
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      PORT: String(port),
      REQUIRE_REDIS: String(requireRedis),
      REDIS_URL: '',
      REDIS_HOST: '',
      REDIS_PORT: '',
      REDIS_PASSWORD: '',
      REDIS_TLS: '',
      SNAPSHOT_ENDPOINT: '',
      ROOM_CLEANUP_ENDPOINT: '',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

  try {
    await waitForHealth(port, child);
  } catch (error) {
    stopIfRunning(child);
    throw new Error(`${error.message}\n${logs}`);
  }
  return { child, port, output: () => logs };
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('server did not become healthy');
}

function stopIfRunning(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}
