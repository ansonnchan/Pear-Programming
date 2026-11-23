#!/usr/bin/env node
// Load test for the realtime editing path: many rooms, five Yjs clients per room, all editing.
//
// Each stage signs in real guest users through the Spring Boot API, creates or joins rooms, and
// connects y-websocket clients to the Node realtime service with each user's realtime token, the same
// path the browser uses. Every client then edits at a fixed rate. Each edit replaces that client's
// previous token with "@@<client>:<seq>:<sentAt>#" in one transaction, so documents stay small.
// Receivers parse inserted tokens and record now - sentAt. Clients run in worker threads in this
// process, so senders and receivers share one clock.
//
// Usage: node room-load.mjs --stages 25,50,100,200 --duration-sec 60 --output results/room-load.json

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { ApiSession, delay, formatSummary, parseArgs, round, summarize } from './lib.mjs';

const execFileAsync = promisify(execFile);
const TOKEN_PATTERN = /@@(\d+):(\d+):([\d.]+)#/g;

if (isMainThread) {
  await runMain();
} else {
  await runWorker();
}

async function runMain() {
  const options = parseArgs(process.argv.slice(2), {
    api: 'http://localhost:8081',
    yjs: 'ws://localhost:1235',
    stages: '25,50,100,200',
    clientsPerRoom: 5,
    editsPerSecond: 2,
    durationSec: 60,
    drainSec: 5,
    workers: Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2))),
    setupConcurrency: 16,
    realtimePid: 0,
    output: ''
  });
  const yjsUrls = options.yjs.split(',').map((url) => url.trim());
  const stages = options.stages.split(',').map(Number);
  const realtimePids = options.realtimePid ? [options.realtimePid] : await findRealtimePids(yjsUrls);
  console.log(`Realtime: ${yjsUrls.join(', ')} (pids ${realtimePids.join(', ') || 'unknown'}); workers: ${options.workers}`);

  const results = [];
  for (const roomCount of stages) {
    const setupStartedAt = Date.now();
    // Fresh rooms per stage, so idle-room cleanup between stages cannot affect a later stage.
    const created = await createRooms(roomCount, options);
    const rooms = created.map((room, index) => ({ ...room, yjsUrl: yjsUrls[index % yjsUrls.length] }));
    console.log(`\nStage ${roomCount} rooms x ${options.clientsPerRoom} clients ` +
      `(setup ${round((Date.now() - setupStartedAt) / 1000)} s)`);
    const result = await runStage(rooms, options, realtimePids);
    results.push(result);
    printStage(result);
    await delay(2000);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    method: 'Real guest sessions and realtime tokens; y-websocket clients (same protocol as the browser) in worker threads. ' +
      'Each client edits at a fixed rate; latency = receiver observe time - sender timestamp embedded in the edit (shared clock). ' +
      'Loss = expected deliveries (edits x other clients in room) not observed within the drain window.',
    environment: {
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      memoryGb: Math.round(os.totalmem() / 2 ** 30),
      node: process.version
    },
    config: { ...options, yjsUrls },
    stages: results
  };
  console.log('\nSummary');
  for (const stage of results) {
    console.log(`  ${stage.rooms} rooms / ${stage.clients} clients / ${stage.achievedEditsPerSecond} edits/s: ` +
      `p50 ${stage.latencyMs?.p50} ms, p95 ${stage.latencyMs?.p95} ms, p99 ${stage.latencyMs?.p99} ms, ` +
      `loss ${stage.lossPercent}%, realtime CPU avg ${stage.realtime.cpuAvgPercent}%`);
  }
  if (options.output) {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${options.output}`);
  }
}

async function createRooms(count, options) {
  const rooms = [];
  let next = 0;
  const runners = Array.from({ length: options.setupConcurrency }, async () => {
    while (next < count) {
      next += 1;
      rooms.push(await createRoom(options));
    }
  });
  await Promise.all(runners);
  return rooms;
}

async function createRoom(options) {
  const lead = new ApiSession(options.api);
  const leadSession = await lead.signIn(`Load lead ${Math.random().toString(36).slice(2, 8)}`);
  const room = await lead.post('/api/rooms/create', {});
  const file = await lead.post(`/api/workspaces/${room.workspaceId}/files`, {
    path: 'main.py',
    content: 'print("pear")\n',
    language: 'python'
  });
  const tokens = [leadSession.realtimeToken];
  for (let index = 1; index < options.clientsPerRoom; index += 1) {
    const member = new ApiSession(options.api);
    const session = await member.signIn(`Load member ${index}`);
    await member.post('/api/rooms/join', { code: room.code });
    tokens.push(session.realtimeToken);
  }
  return { code: room.code, fileId: file.id, tokens };
}

async function runStage(rooms, options, realtimePids) {
  const workerCount = Math.min(options.workers, rooms.length);
  const assignments = Array.from({ length: workerCount }, () => []);
  rooms.forEach((room, index) => assignments[index % workerCount].push(room));

  const workers = assignments.map((assigned, index) => new Worker(new URL(import.meta.url), {
    workerData: { rooms: assigned, workerIndex: index, options }
  }));
  const ready = workers.map((worker) => waitForMessage(worker, 'ready'));
  const connectResults = await Promise.all(ready);
  const connectFailures = connectResults.reduce((sum, message) => sum + message.failures, 0);

  const startAt = performance.timeOrigin + performance.now() + 500;
  const sampler = sampleProcesses(realtimePids);
  const done = workers.map((worker) => waitForMessage(worker, 'done'));
  workers.forEach((worker) => worker.postMessage({ type: 'start', startAt }));
  const outcomes = await Promise.all(done);
  const processSamples = sampler.stop();
  await Promise.all(workers.map((worker) => worker.terminate()));

  const latencies = [];
  let sent = 0;
  let expected = 0;
  let received = 0;
  let maxLoopLagMs = 0;
  for (const outcome of outcomes) {
    for (const value of outcome.latencies) latencies.push(value);
    sent += outcome.sent;
    expected += outcome.expected;
    received += outcome.received;
    maxLoopLagMs = Math.max(maxLoopLagMs, outcome.loopLagP99Ms);
  }
  const clients = rooms.length * options.clientsPerRoom;
  return {
    rooms: rooms.length,
    clients,
    targetEditsPerSecond: clients * options.editsPerSecond,
    achievedEditsPerSecond: round(sent / options.durationSec),
    deliveriesPerSecond: round(received / options.durationSec),
    connectFailures,
    sent,
    expectedDeliveries: expected,
    receivedDeliveries: received,
    lossPercent: expected === 0 ? 0 : round(((expected - received) / expected) * 100),
    latencyMs: summarize(latencies),
    generatorLoopLagP99Ms: round(maxLoopLagMs),
    realtime: summarizeProcessSamples(processSamples)
  };
}

function printStage(stage) {
  console.log(`  edits: ${stage.sent} sent (${stage.achievedEditsPerSecond}/s of ${stage.targetEditsPerSecond}/s target), ` +
    `deliveries ${stage.receivedDeliveries}/${stage.expectedDeliveries} (loss ${stage.lossPercent}%), ` +
    `connect failures ${stage.connectFailures}`);
  console.log(formatSummary('  fan-out latency', stage.latencyMs));
  console.log(`  realtime CPU avg ${stage.realtime.cpuAvgPercent}% max ${stage.realtime.cpuMaxPercent}%, ` +
    `RSS max ${stage.realtime.rssMaxMb} MB; generator loop lag p99 ${stage.generatorLoopLagP99Ms} ms`);
  if (stage.generatorLoopLagP99Ms > 25) {
    console.log('  warning: the load generator itself is lagging; add --workers or treat this stage as unreliable');
  }
}

function waitForMessage(worker, type) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message.type === type) {
        worker.off('message', onMessage);
        resolve(message);
      }
    };
    worker.on('message', onMessage);
    worker.once('error', reject);
  });
}

async function findRealtimePids(yjsUrls) {
  const pids = [];
  for (const url of yjsUrls) {
    const port = new URL(url).port;
    try {
      const { stdout } = await execFileAsync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
      const pid = Number(stdout.trim().split('\n')[0]);
      if (pid) pids.push(pid);
    } catch {
      // The realtime service may be remote or in a container; CPU sampling is then skipped.
    }
  }
  return pids;
}

function sampleProcesses(pids) {
  const samples = [];
  let stopped = false;
  (async () => {
    while (!stopped && pids.length > 0) {
      try {
        const { stdout } = await execFileAsync('ps', ['-o', 'pid=,%cpu=,rss=', '-p', pids.join(',')]);
        let cpu = 0;
        let rssKb = 0;
        for (const line of stdout.trim().split('\n')) {
          const [, cpuValue, rssValue] = line.trim().split(/\s+/).map(Number);
          cpu += cpuValue;
          rssKb += rssValue;
        }
        samples.push({ cpu, rssMb: rssKb / 1024 });
      } catch {
        // Ignore a missed sample.
      }
      await delay(1000);
    }
  })();
  return { stop: () => { stopped = true; return samples; } };
}

function summarizeProcessSamples(samples) {
  // Skip the first sample: ps reports a lifetime average until it has a recent interval.
  const usable = samples.slice(1);
  if (usable.length === 0) return { cpuAvgPercent: null, cpuMaxPercent: null, rssMaxMb: null };
  return {
    cpuAvgPercent: round(usable.reduce((sum, sample) => sum + sample.cpu, 0) / usable.length),
    cpuMaxPercent: round(Math.max(...usable.map((sample) => sample.cpu))),
    rssMaxMb: round(Math.max(...usable.map((sample) => sample.rssMb)))
  };
}

async function runWorker() {
  const [{ default: WebSocket }, Y, { WebsocketProvider }, { monitorEventLoopDelay }] = await Promise.all([
    import('ws'),
    import('yjs'),
    import('y-websocket'),
    import('node:perf_hooks')
  ]);
  // y-websocket registers a process exit listener per provider.
  process.setMaxListeners(0);
  const { rooms, workerIndex, options } = workerData;
  const now = () => performance.timeOrigin + performance.now();
  const clients = [];
  let failures = 0;
  let measuring = false;
  let measureFrom = Infinity;
  let received = 0;
  const latencies = [];

  for (const room of rooms) {
    const roomClients = [];
    for (let index = 0; index < room.tokens.length; index += 1) {
      const doc = new Y.Doc();
      const text = doc.getText('monaco');
      const provider = new WebsocketProvider(room.yjsUrl, `${room.code}/${room.fileId}`, doc, {
        WebSocketPolyfill: WebSocket,
        params: { access_token: room.tokens[index] },
        disableBc: true
      });
      const client = { id: workerIndex * 100_000 + clients.length, doc, text, provider, seq: 0, lastToken: '', room: roomClients };
      text.observe((event, transaction) => {
        if (transaction.local || !measuring) return;
        const observedAt = now();
        for (const change of event.delta) {
          if (typeof change.insert !== 'string') continue;
          for (const match of change.insert.matchAll(TOKEN_PATTERN)) {
            const sentAt = Number(match[3]);
            if (sentAt < measureFrom) continue;
            received += 1;
            latencies.push(observedAt - sentAt);
          }
        }
      });
      roomClients.push(client);
      clients.push(client);
    }
  }

  const syncDeadline = Date.now() + 30_000;
  await Promise.all(clients.map((client) => new Promise((resolve) => {
    if (client.provider.synced) return resolve();
    const timer = setInterval(() => {
      if (client.provider.synced) { clearInterval(timer); resolve(); }
      else if (Date.now() > syncDeadline) { clearInterval(timer); failures += 1; client.failed = true; resolve(); }
    }, 50);
  })));
  parentPort.postMessage({ type: 'ready', failures });

  const { startAt } = await new Promise((resolve) => parentPort.once('message', resolve));
  await delay(Math.max(0, startAt - now()));
  measureFrom = startAt;
  measuring = true;
  const loopDelay = monitorEventLoopDelay({ resolution: 5 });
  loopDelay.enable();

  const endAt = startAt + options.durationSec * 1000;
  const intervalMs = 1000 / options.editsPerSecond;
  let sent = 0;
  let expected = 0;
  const activeClients = clients.filter((client) => !client.failed);
  await Promise.all(activeClients.map(async (client) => {
    // Spread clients across the interval so edits do not arrive in lockstep.
    await delay(Math.random() * intervalMs);
    let nextAt = now();
    while (nextAt < endAt) {
      const token = `@@${client.id}:${client.seq}:${now().toFixed(3)}#`;
      client.seq += 1;
      client.doc.transact(() => {
        if (client.lastToken) {
          const position = client.text.toString().indexOf(client.lastToken);
          if (position >= 0) client.text.delete(position, client.lastToken.length);
        }
        client.text.insert(0, token);
      });
      client.lastToken = token;
      sent += 1;
      expected += client.room.filter((other) => other !== client && !other.failed).length;
      nextAt += intervalMs;
      await delay(Math.max(0, nextAt - now()));
    }
  }));

  await delay(options.drainSec * 1000);
  measuring = false;
  loopDelay.disable();
  for (const client of clients) {
    client.provider.destroy();
    client.doc.destroy();
  }
  parentPort.postMessage({
    type: 'done',
    sent,
    expected,
    received,
    latencies,
    loopLagP99Ms: loopDelay.percentile(99) / 1e6
  });
}
