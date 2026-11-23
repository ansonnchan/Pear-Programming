# Performance

Measured on 2026-11-22. Every number below comes from a script in [bench/](../bench/) or
[scripts/](../scripts/).

## Environment

Everything ran on one laptop, so these numbers show what the software can do, not what the free-tier
deployment delivers over the internet.

- Apple M2 Max, 12 cores, 64 GB, macOS 26.6.2
- Docker 29.9.3: PostgreSQL 16, Redis 7, and Spring Boot on `eclipse-temurin:21-jre`
- Realtime service on Node 24.17.0, outside Docker
- Frontend production build served by `vite preview`
- Browsers: Chromium 149 through Playwright 1.61.0, headless, with background throttling disabled
- Code runner: the public Wandbox service

## Summary

| What | Result |
| --- | --- |
| Edit latency, 5 browser clients, one realtime instance | p50 6.6 ms, p95 10.2 ms (1,200 of 1,200 deliveries) |
| Edit latency, 5 browser clients split across two realtime instances | p50 7.8 ms, p95 12.1 ms overall; the Redis-relayed hop is p95 12.6 ms |
| Sustained load on one realtime instance | 400 rooms, 2,000 clients, 4,000 edits/s: p95 2.7 ms, p99 19 ms, 0% loss |
| Load at which that instance saturates | 800 rooms, 8,000 edits/s: p95 301 ms, still 0% loss |
| Crashed execution requeued (20 real `SIGKILL`s) | p50 5.7 s, p95 6.7 s; 20 of 20 jobs completed with correct output |
| Python run time through Wandbox (30 runs) | median 1.75 s for completed runs; 8 of 30 slowed or failed by Wandbox rate limits |

## Edit latency between browsers

[bench/edit-latency.mjs](../bench/edit-latency.mjs)

**Method.** Five Chromium clients use separate browser contexts, so each has its own guest session.
Each one signs in through the landing page, joins one room, and opens the same 30-line `main.py` in
Monaco. The clients take turns typing a token such as `@@42# ` at the start of the file, one key at
a time, 25 ms apart. The writer records the `keydown` time of the token's closing `#`. Every client's
`MutationObserver` records when the complete token first appears in its own editor DOM.

Latency for each receiver is receiver DOM time minus writer keydown time. All clients share one clock,
so no clock-skew correction is needed. Each run is 300 measured edits after 10 warmups, which gives
1,200 deliveries to four receivers.

The writer's keydown-to-own-DOM time is reported as a baseline. It is the local cost of Monaco and
y-monaco, and it is included in every remote number.

| Setup | Deliveries | p50 | p95 | p99 | Max |
| --- | --- | --- | --- | --- | --- |
| One realtime instance | 1,200 / 1,200 | 6.6 ms | 10.2 ms | 11.1 ms | 13.1 ms |
| Local echo baseline (same run) | — | 5.6 ms | 9.0 ms | 9.7 ms | 11.3 ms |
| Two instances, all deliveries | 1,200 / 1,200 | 7.8 ms | 12.1 ms | 14.1 ms | 22.6 ms |
| Two instances, same-instance pairs | 480 | 6.5 ms | 10.3 ms | 11.5 ms | 12.8 ms |
| Two instances, relayed through Redis pub/sub | 720 | 8.7 ms | 12.6 ms | 18.7 ms | 22.6 ms |

For the two-instance run, a second frontend build pointed three clients at realtime instance A and two
at instance B. Both instances shared one Redis.

This measurement found a bug: before the fix, all 720 cross-instance deliveries were lost.

- **Cause.** Each instance seeded a new file's plain-text snapshot into Yjs under its own random
  client ID. The two instances' copies therefore had no items in common, and every relayed update
  referenced items the other side never had. A single instance that restarted before its first
  snapshot flush hit the same problem with its own Redis update log.
- **Fix.** Seeding now uses a client ID derived from the file ID and the text, so every instance
  creates identical items. `realtime/src/server.test.cjs` covers this.

## Concurrent room load

[bench/room-load.mjs](../bench/room-load.mjs)

**Method.** Each stage creates fresh rooms through the real API.

- **Clients.** One lead and four members, each with its own guest session. Every member connects a
  y-websocket client, the browser's protocol, using its own realtime token, so every connection is
  validated by the backend.
- **Edits.** Every client edits twice a second for 60 seconds. Each edit replaces that client's
  previous token with a new one carrying its send time, as one Yjs transaction.
- **Measurement.** Receivers record observe time minus send time. Loss is any expected delivery
  (edits × the other clients in the room) that is not seen within five seconds of the stage ending.
- **Generator and sampling.** Clients run in 6–8 worker threads. The generator's own event-loop lag
  stayed under 12 ms p99 in every stage, so it was not the bottleneck. The realtime process's CPU and
  memory were sampled with `ps` every second, where 100% means one core.

Every edit also goes through the production write path: append to the Redis update log and publish
on Redis pub/sub.

| Rooms | Clients | Edits/s | Deliveries | p50 | p95 | p99 | Loss | Realtime CPU (avg / max) | RSS max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | 125 | 250 | 60,000 | 0.61 ms | 1.27 ms | 1.87 ms | 0% | 10% / 16% | 124 MB |
| 50 | 250 | 500 | 120,000 | 0.41 ms | 0.99 ms | 1.51 ms | 0% | 12% / 18% | 215 MB |
| 100 | 500 | 1,000 | 240,000 | 0.34 ms | 0.63 ms | 1.01 ms | 0% | 18% / 31% | 262 MB |
| 200 | 1,000 | 2,000 | 480,000 | 0.35 ms | 0.86 ms | 1.68 ms | 0% | 33% / 52% | 334 MB |
| 400 | 2,000 | 4,000 | 959,968 | 0.54 ms | 2.72 ms | 19.4 ms | 0% | 57% / 82% | 512 MB |
| 600 | 3,000 | 6,000 | 1,439,996 | 0.86 ms | 15.2 ms | 105 ms | 0% | 74% / 105% | 533 MB |
| 800 | 4,000 | 8,000 | 1,919,852 | 9.88 ms | 301 ms | 628 ms | 0% | 91% / 173% | 719 MB |

The 600 and 800 stages ran in a separate invocation after the first five.

The realtime service is one Node event loop. Tail latency starts rising between 400 and 600 rooms, and
by 800 rooms the event loop is saturated. Delivery stays complete even there; edits just queue. Two
edits a second from every member of every room is much heavier than real use, where most
collaborators are reading at any given moment.

These latencies are lower than the browser numbers because they leave out Monaco and the DOM. They
measure the server path only.

## Execution queue crash recovery

[bench/execution-crash.mjs](../bench/execution-crash.mjs)

**Method.** Two backend containers share Redis and PostgreSQL. Each trial does the following:

1. Submit a Python program that sleeps 4 seconds and prints `pear`.
2. Wait until a worker holds the job's lease, then `docker kill` that container 0.5–2.5 s later
   (random), while the program is running on Wandbox.
3. Poll the job's Redis hash every 5 ms to time three points from the kill: the job is requeued,
   another worker holds the lease, and the user-visible result is `COMPLETED` with output `pear`.

The killed container is restarted between trials. The lease is 6 s and the recovery scan runs every
1 s.

| From the kill to | p50 | p95 | Max |
| --- | --- | --- | --- |
| Requeued | 5.67 s | 6.66 s | 6.66 s |
| Claimed by the surviving backend | 5.75 s | 6.78 s | 6.82 s |
| Completed with correct output | 12.3 s | 14.3 s | 14.9 s |

All 20 jobs completed correctly. Submit to completion, including the crash, was 14.6 s at p50 and 17.1 s
at the maximum, inside the 20-second execution deadline.

**Before the fix.** The worker lease was 30 seconds, longer than the 20-second deadline, because a
worker could not renew its lease while blocked in a Wandbox request. `ExecutionRecoveryBenchmark` with
the old settings measured a 30.1 s p50 requeue, so a crashed job always timed out before another
worker could pick it up. Workers now renew their lease from a heartbeat every lease/3, which allows a
6-second lease.

`ExecutionRecoveryBenchmark` measures the worst case: a worker that dies right after renewing its
lease. Over 100 jobs against Redis it gives 6.14 s p50 and 6.22 s p95, against 30.1 s p50 with the
old settings.

## Code execution run time

[scripts/benchmark-execution.mjs](../scripts/benchmark-execution.mjs)

**Method.** 30 measured runs after 3 warmups, one at a time, through the local backend to the public
Wandbox service. The program is `print("pear")`, and the timed span is the client's submit request to
seeing a terminal status (polling every 100 ms).

Wandbox answered some requests with HTTP 429 (Too many requests). This run came straight after the
crash trials, so the service was already throttling us. Three runs failed after the backend's retries
were used up, and five completed only after retrying.

| Runs | Median | p95 |
| --- | --- | --- |
| All 30, failures included | 2.08 s | 20.8 s |
| 27 completed | 1.75 s | 18.5 s |
| 22 completed without throttling | 1.53 s | 3.04 s |

Submission itself (the request returning a queued job) took 6.7 ms at p50. Almost all the run time is
Wandbox. To measure without throttling, space the runs out:

```bash
node scripts/benchmark-execution.mjs --base-url http://localhost:8081 --language python \
  --warmup 3 --runs 30 --gap-ms 6000 --output execution-python.json
```

The script now re-joins its room once a minute. Room members expire after three minutes without a
presence heartbeat, so a run longer than that used to stop partway with `403 room_forbidden`.

## Reproducing

[bench/README.md](../bench/README.md) has the commands. These runs used isolated containers on spare
host ports (PostgreSQL 5442, Redis 6390, backends 8081–8083). The backends had
`EXECUTION_RATE_LIMIT_PER_MINUTE=100000` so the benchmark was not limited by Pear Programming's
per-user rate limit.
