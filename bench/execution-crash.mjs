#!/usr/bin/env node
// Crash-recovery test for the Redis execution queue with real backend processes.
//
// Two or more Spring Boot containers share one Redis and one PostgreSQL. Each trial submits a slow
// program through the "victim" backend, waits until a worker holds the job's lease, then SIGKILLs the
// container that holds it (docker kill). A surviving backend must notice the expired lease, requeue the
// job, claim it, and run it to completion before the execution deadline. Timestamps come from polling
// the job's Redis hash every few milliseconds:
//   kill -> requeued   lease expiry detected and the job put back on the queue
//   kill -> reclaimed  another worker holds the lease
//   kill -> completed  the user-visible result is COMPLETED with the expected output
// The killed container is restarted between trials.
//
// Usage:
//   node execution-crash.mjs --backends pearbench-backend-b=http://localhost:8082,pearbench-backend-c=http://localhost:8083 \
//     --trials 20 --output results/execution-crash.json

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import Redis from 'ioredis';
import { ApiSession, delay, formatSummary, parseArgs, round, summarize } from './lib.mjs';

const execFileAsync = promisify(execFile);
const TERMINAL = new Set(['COMPLETED', 'COMPILATION_ERROR', 'RUNTIME_ERROR', 'TIMED_OUT', 'FAILED', 'CANCELLED']);

const options = parseArgs(process.argv.slice(2), {
  backends: 'pearbench-backend-b=http://localhost:8082,pearbench-backend-c=http://localhost:8083',
  redis: 'redis://localhost:6390',
  keyPrefix: 'pearprogram',
  trials: 20,
  language: 'python',
  sleepSec: 4,
  minKillDelayMs: 500,
  maxKillDelayMs: 2500,
  pollMs: 5,
  trialTimeoutMs: 40_000,
  output: ''
});

const backends = options.backends.split(',').map((entry) => {
  const [container, url] = entry.split('=');
  return { container, url };
});
if (backends.length < 2) throw new Error('Need at least two backends: one to kill and one to recover');

const redis = new Redis(options.redis);
const prefix = `${options.keyPrefix}:execution`;
const source = `import time\ntime.sleep(${options.sleepSec})\nprint("pear")\n`;
const trials = [];

try {
  for (let trial = 0; trial < options.trials; trial += 1) {
    const victim = backends[trial % backends.length];
    const result = await runTrial(trial, victim);
    trials.push(result);
    console.log(`trial ${trial + 1}/${options.trials} via ${victim.container}: ` +
      (result.valid
        ? `killed ${result.killedContainer} at +${result.killDelayMs} ms; requeued ${result.requeuedMs} ms, ` +
          `reclaimed ${result.reclaimedMs} ms, completed ${result.completedMs} ms (${result.status})`
        : `skipped (${result.reason})`));
    await restartIfStopped();
  }
} finally {
  await restartIfStopped().catch(() => {});
  redis.disconnect();
}

const valid = trials.filter((trial) => trial.valid);
const succeeded = valid.filter((trial) => trial.status === 'COMPLETED' && trial.outputOk);
const report = {
  generatedAt: new Date().toISOString(),
  method: 'SIGKILL (docker kill) of the backend container holding the execution lease while the program runs on Wandbox; ' +
    'times measured from the kill by polling the job hash in Redis. Program sleeps ' + options.sleepSec + ' s then prints. ' +
    'Kill delay after claim is random in [' + options.minKillDelayMs + ', ' + options.maxKillDelayMs + '] ms.',
  config: { ...options, backends },
  trials: trials.length,
  validTrials: valid.length,
  completedAfterCrash: succeeded.length,
  killToRequeuedMs: summarize(valid.map((trial) => trial.requeuedMs)),
  killToReclaimedMs: summarize(valid.map((trial) => trial.reclaimedMs)),
  killToCompletedMs: summarize(succeeded.map((trial) => trial.completedMs)),
  submitToCompletedMs: summarize(succeeded.map((trial) => trial.submitToCompletedMs)),
  results: trials
};

console.log(`\nExecution crash recovery: ${succeeded.length}/${valid.length} crashed jobs completed correctly`);
console.log(formatSummary('  kill to requeued', report.killToRequeuedMs));
console.log(formatSummary('  kill to reclaimed', report.killToReclaimedMs));
console.log(formatSummary('  kill to completed', report.killToCompletedMs));
console.log(formatSummary('  submit to completed', report.submitToCompletedMs));
if (options.output) {
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${options.output}`);
}

async function runTrial(index, victim) {
  await waitHealthy(victim.url);
  const session = new ApiSession(victim.url);
  await session.signIn(`Crash test ${index + 1}`);
  const room = await session.post('/api/rooms/create', {});
  const submittedAt = performance.now();
  const submitted = await session.post(
    `/api/rooms/${room.code}/executions`,
    { language: options.language, sourceCode: source, stdin: '' },
    { 'Idempotency-Key': `crash-${Date.now()}-${index}` }
  );
  const id = submitted.executionId;
  const jobKey = `${prefix}:job:${id}`;
  const recordKey = `${prefix}:record:${id}`;

  const firstOwner = await waitFor(async () => (await redis.hget(jobKey, 'leaseOwner')) || null, 5_000);
  if (!firstOwner) return { trial: index + 1, valid: false, reason: 'job was never claimed' };
  const owner = await findContainerForWorker(firstOwner);
  if (!owner) return { trial: index + 1, valid: false, reason: 'could not map the lease owner to a container' };

  const killDelayMs = Math.round(options.minKillDelayMs + Math.random() * (options.maxKillDelayMs - options.minKillDelayMs));
  await delay(killDelayMs);
  const statusBeforeKill = await redis.hget(recordKey, 'status');
  if (TERMINAL.has(statusBeforeKill)) {
    return { trial: index + 1, valid: false, reason: `finished before the kill (${statusBeforeKill})` };
  }
  await execFileAsync('docker', ['kill', '--signal', 'KILL', owner.container]);
  const killedAt = performance.now();

  let requeuedAt = null;
  let reclaimedAt = null;
  let completedAt = null;
  let status = statusBeforeKill;
  const deadline = killedAt + options.trialTimeoutMs;
  while (performance.now() < deadline) {
    const [[, job], [, record]] = await redis.multi().hgetall(jobKey).hgetall(recordKey).exec();
    const now = performance.now();
    const leaseOwner = job?.leaseOwner ?? '';
    const retries = Number(job?.retryCount ?? 0);
    if (requeuedAt === null && retries >= 1) requeuedAt = now;
    if (reclaimedAt === null && leaseOwner && leaseOwner !== firstOwner) {
      reclaimedAt = now;
      if (requeuedAt === null) requeuedAt = now;
    }
    status = record?.status ?? status;
    if (TERMINAL.has(status)) {
      completedAt = now;
      break;
    }
    await delay(options.pollMs);
  }

  const survivor = backends.find((backend) => backend.container !== owner.container);
  session.origin = survivor.url;
  let final = null;
  try {
    final = await session.get(`/api/rooms/${room.code}/executions/${id}`);
  } catch (error) {
    final = { status, message: error.message };
  }
  return {
    trial: index + 1,
    valid: requeuedAt !== null || TERMINAL.has(status),
    executionId: id,
    killedContainer: owner.container,
    killDelayMs,
    statusBeforeKill,
    requeuedMs: requeuedAt === null ? null : round(requeuedAt - killedAt),
    reclaimedMs: reclaimedAt === null ? null : round(reclaimedAt - killedAt),
    completedMs: completedAt === null ? null : round(completedAt - killedAt),
    submitToCompletedMs: completedAt === null ? null : round(completedAt - submittedAt),
    status: final?.status ?? status,
    outputOk: (final?.stdout ?? '').trim() === 'pear',
    message: final?.message ?? null
  };
}

// Each backend logs its worker id at startup; match the lease owner against container logs.
async function findContainerForWorker(workerId) {
  for (const backend of backends) {
    const { stdout, stderr } = await execFileAsync('docker', ['logs', backend.container], { maxBuffer: 64 * 1024 * 1024 });
    if (`${stdout}${stderr}`.includes(workerId)) return backend;
  }
  return null;
}

async function restartIfStopped() {
  for (const backend of backends) {
    const { stdout } = await execFileAsync('docker', ['inspect', '-f', '{{.State.Running}}', backend.container]);
    if (stdout.trim() !== 'true') {
      await execFileAsync('docker', ['start', backend.container]);
    }
  }
  for (const backend of backends) await waitHealthy(backend.url);
}

async function waitHealthy(url) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await delay(250);
  }
  throw new Error(`${url} did not become healthy`);
}

async function waitFor(check, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(options.pollMs);
  }
  return null;
}
