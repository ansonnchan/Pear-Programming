#!/usr/bin/env node
// Measures edit latency between real browser clients in one Pear Programming room.
//
// Method: N Chromium clients (separate browser contexts, so separate guest sessions) sign in through
// the landing page, join one room, and open the same file in Monaco. Clients take turns typing a
// unique token such as "@@42#". The writer records the keydown time of the closing "#"; every other
// client's MutationObserver records when the complete token first appears in its rendered editor DOM.
// Latency = receiver DOM time - writer keydown time. All clients run on one machine, so they share one
// clock and need no clock-skew correction. The writer's own keydown-to-DOM time is reported as the
// local echo baseline.
//
// Usage: node edit-latency.mjs --clients 5 --samples 300 --output results/edit-latency.json

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { delay, formatSummary, parseArgs, summarize } from './lib.mjs';

const options = parseArgs(process.argv.slice(2), {
  frontends: 'http://localhost:5174',
  api: 'http://localhost:8081',
  clients: 5,
  samples: 300,
  warmup: 10,
  typingDelayMs: 25,
  gapMs: 400,
  settleMs: 3000,
  headed: false,
  screenshots: '',
  includeSamples: false,
  output: ''
});

const frontends = options.frontends.split(',').map((url) => url.trim().replace(/\/+$/, ''));
const cursorToStart = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';
const fileContent = Array.from({ length: 30 }, (_, index) => `print("pear ${index + 1}")`).join('\n') + '\n';

const browser = await chromium.launch({
  headless: !options.headed,
  // Each simulated user would have their own focused tab on their own machine, so do not let
  // Chromium throttle the other tabs in this single process.
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'
  ]
});

const clients = [];
try {
  for (let index = 0; index < options.clients; index += 1) {
    const frontend = frontends[index % frontends.length];
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    clients.push({ index, frontend, context, page, name: `Bench ${index + 1}` });
  }

  const roomCode = await createRoom(clients[0]);
  await addFile(clients[0], roomCode);
  await openFile(clients[0], true);
  for (const client of clients.slice(1)) {
    await joinRoom(client, roomCode);
    await openFile(client, false);
  }
  for (const client of clients) {
    await installObserver(client.page);
  }
  console.log(`Room ${roomCode}: ${clients.length} clients ready (${frontends.join(', ')})`);

  const total = options.warmup + options.samples;
  const writes = [];
  for (let seq = 0; seq < total; seq += 1) {
    const writer = clients[seq % clients.length];
    await writer.page.keyboard.press(cursorToStart);
    await writer.page.keyboard.type(`@@${seq}# `, { delay: options.typingDelayMs });
    writes.push({ seq, writer: writer.index, warmup: seq < options.warmup });
    // Random jitter keeps edits from lining up with any periodic server work.
    await delay(options.gapMs + Math.random() * options.gapMs * 0.5);
    if ((seq + 1) % 50 === 0) console.log(`  ${seq + 1}/${total} edits`);
  }
  await delay(options.settleMs);
  if (options.screenshots) {
    await mkdir(options.screenshots, { recursive: true });
    await Promise.all(clients.map((client) => client.page.screenshot({ path: `${options.screenshots}/client-${client.index + 1}.png` })));
  }

  const seenByClient = await Promise.all(clients.map((client) => client.page.evaluate(() => window.__pearSeen)));
  const keydownsByClient = await Promise.all(clients.map((client) => client.page.evaluate(() => window.__pearKeydowns)));
  // The k-th closing keydown on a page belongs to the k-th token that client wrote.
  const writeCounts = new Map();
  for (const write of writes) {
    const k = writeCounts.get(write.writer) ?? 0;
    writeCounts.set(write.writer, k + 1);
    write.keydownAt = keydownsByClient[write.writer][k];
  }
  const samples = [];
  const localEcho = [];
  let missing = 0;
  for (const write of writes) {
    if (write.warmup) continue;
    const writtenAt = write.keydownAt;
    const ownSeenAt = seenByClient[write.writer][write.seq];
    if (writtenAt !== undefined && ownSeenAt !== undefined) localEcho.push(ownSeenAt - writtenAt);
    for (const receiver of clients) {
      if (receiver.index === write.writer) continue;
      const receivedAt = seenByClient[receiver.index][write.seq];
      if (writtenAt === undefined || receivedAt === undefined) {
        missing += 1;
        continue;
      }
      samples.push({
        seq: write.seq,
        writer: write.writer,
        receiver: receiver.index,
        crossInstance: clients[write.writer].frontend !== receiver.frontend,
        latencyMs: receivedAt - writtenAt
      });
    }
  }

  const latencies = samples.map((sample) => sample.latencyMs);
  const report = {
    generatedAt: new Date().toISOString(),
    method: 'Time from the writer\'s keydown of a token\'s final character to the complete token appearing in each other ' +
      'client\'s Monaco DOM. Clients are separate Chromium contexts on one machine (shared clock). Writers rotate; ' +
      'tokens are typed key by key at the start of the file.',
    environment: environment(await browser.version()),
    config: { ...options, frontends, roomCode },
    edits: options.samples,
    expectedDeliveries: options.samples * (clients.length - 1),
    missingDeliveries: missing,
    latencyMs: summarize(latencies),
    localEchoMs: summarize(localEcho),
    sameInstanceLatencyMs: summarize(samples.filter((sample) => !sample.crossInstance).map((sample) => sample.latencyMs)),
    crossInstanceLatencyMs: summarize(samples.filter((sample) => sample.crossInstance).map((sample) => sample.latencyMs)),
    // One row per delivery is about 8,000 lines per run, so it is opt-in.
    ...(options.includeSamples ? { samples } : {})
  };

  console.log(`\nEdit latency across ${clients.length} browser clients (${options.samples} edits, ${samples.length} deliveries, ${missing} missing)`);
  console.log(formatSummary('  keystroke to remote editor', report.latencyMs));
  console.log(formatSummary('  keystroke to own editor (baseline)', report.localEchoMs));
  if (frontends.length > 1) {
    console.log(formatSummary('  same realtime instance', report.sameInstanceLatencyMs));
    console.log(formatSummary('  across instances via Redis', report.crossInstanceLatencyMs));
  }
  if (options.output) {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${options.output}`);
  }
} finally {
  await browser.close();
}

async function createRoom(client) {
  const { page } = client;
  await page.goto(`${client.frontend}/`);
  await page.getByRole('button', { name: 'Create Pear Room' }).click();
  await completeProfile(client);
  await page.waitForURL(/\/join\//);
  return page.url().split('/join/')[1];
}

async function joinRoom(client, roomCode) {
  const { page } = client;
  await page.goto(`${client.frontend}/`);
  await page.locator('#landing-room-code').fill(roomCode);
  await page.getByRole('button', { name: 'Join Pear Room' }).click();
  await completeProfile(client);
  await page.waitForURL(/\/join\//);
}

async function completeProfile(client) {
  const dialog = client.page.getByRole('dialog');
  await dialog.getByLabel('Display name').fill(client.name);
  await dialog.getByRole('button', { name: 'Continue' }).click();
}

async function addFile(client, roomCode) {
  const request = client.context.request;
  const csrf = await (await request.get(`${options.api}/api/auth/csrf`)).json();
  const room = await (await request.get(`${options.api}/api/rooms/${roomCode}`)).json();
  const response = await request.post(`${options.api}/api/workspaces/${room.workspaceId}/files`, {
    data: { path: 'main.py', content: fileContent, language: 'python' },
    headers: { [csrf.headerName]: csrf.token }
  });
  if (!response.ok()) throw new Error(`Could not add main.py: ${response.status()} ${await response.text()}`);
}

async function openFile(client, reload) {
  const { page } = client;
  if (reload) await page.reload();
  await page.getByText('main.py').first().click();
  await page.waitForFunction(
    // Monaco renders spaces as non-breaking spaces.
    () => /pear\s1/u.test(document.querySelector('.monaco-editor .view-lines')?.textContent ?? ''),
    undefined,
    { timeout: 15_000 }
  );
  await page.getByText('Synced').first().waitFor({ timeout: 15_000 });
  // Focus Monaco's input directly; toasts can cover the text area while other clients join. Monaco
  // takes keyboard input through the native EditContext element where Chromium supports it, and
  // through its hidden textarea otherwise.
  const input = page.locator('.monaco-editor .native-edit-context');
  await ((await input.count()) > 0 ? input : page.locator('.monaco-editor textarea.inputarea')).first().focus();
}

async function installObserver(page) {
  await page.evaluate(() => {
    const root = document.querySelector('.monaco-editor .view-lines');
    const seen = {};
    const keydowns = [];
    window.__pearSeen = seen;
    window.__pearKeydowns = keydowns;
    document.addEventListener('keydown', (event) => {
      if (event.key === '#') keydowns.push(performance.timeOrigin + performance.now());
    }, true);
    const scan = () => {
      const now = performance.timeOrigin + performance.now();
      for (const match of root.textContent.matchAll(/@@(\d+)#/g)) {
        if (!(match[1] in seen)) seen[match[1]] = now;
      }
    };
    new MutationObserver(scan).observe(root, { subtree: true, childList: true, characterData: true });
  });
}

function environment(browserVersion) {
  return {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
    chromium: browserVersion
  };
}
