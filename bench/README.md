# Benchmarks

Scripts that measure Pear Programming end to end against a running stack. Results and the exact
method for each run are in [docs/performance.md](../docs/performance.md). Reports written with
`--output` go to `results/`, which git ignores.

```bash
cd bench && npm install
```

`edit-latency.mjs` uses Playwright 1.61.0 (Chromium 1228). Run `npx playwright install chromium`
if that browser is not already cached.

## Edit latency between browsers

```bash
node edit-latency.mjs --clients 5 --samples 300 --output results/edit-latency-single-instance.json
```

Opens five Chromium clients, signs each in as a guest through the landing page, joins one room, and
opens the same file. Clients take turns typing tokens; latency is the writer's keydown of a token's
last character to that token appearing in each other client's Monaco DOM. Pass two comma-separated
`--frontends` (each built with a different `VITE_YJS_URL`) to split clients across two realtime
instances and measure the Redis pub/sub path. Reports keep only summaries; add `--include-samples` to keep one row per delivery.

## Concurrent room load

```bash
node room-load.mjs --stages 25,50,100,200,400 --duration-sec 60 --output results/room-load-single-instance.json
```

Each stage signs in real guest users, creates rooms of five, and connects y-websocket clients with
their realtime tokens. Every client edits twice a second; receivers record delivery latency and loss.
The realtime process CPU and memory are sampled with `ps` when it runs on this machine.

## Execution crash recovery

```bash
node execution-crash.mjs --trials 20 --output results/execution-crash.json
```

Needs two backend containers sharing Redis (defaults: `pearbench-backend-b` on 8082 and
`pearbench-backend-c` on 8083). Each trial submits a slow program, SIGKILLs the container holding
the job's lease, and times requeue, reclaim, and completion on the surviving backend.

## Execution latency

The run-time benchmark lives at [scripts/benchmark-execution.mjs](../scripts/benchmark-execution.mjs).
