# Execution performance

Pear Programming records execution latency without treating the provider's program runtime as end-to-end latency.

Wandbox, the default provider, runs code synchronously and does not report program runtime. With Wandbox, orchestration overhead is therefore not recorded, and Judge0 polling settings do not apply. The metrics below describe the Judge0 provider unless noted.

## Metrics

Spring Actuator and Prometheus expose:

| Metric | Definition |
| --- | --- |
| `execution_queue_wait_seconds` | Submission acceptance to the first worker claim |
| `execution_end_to_end_seconds` | Submission acceptance to a terminal execution state |
| `execution_orchestration_overhead_seconds` | End-to-end time minus Judge0-reported program runtime |
| `execution_recovery_detection_delay_seconds` | Lease expiration to recovery processing |
| `execution_recoveries_total` | Expired leases processed, tagged as requeued or finalized |
| `execution_queue_depth` | Jobs currently available for workers to claim |

Latency timers publish p50, p95, and p99 percentiles plus histogram buckets. Metrics do not use room or user identifiers as tags, avoiding unbounded metric cardinality.

`execution_orchestration_overhead_seconds` is an approximation. It includes queueing, network time, Judge0 queueing and compilation, and result-polling delay because Judge0's `time` field only reports program runtime.

## End-to-end benchmark

Start the application with Judge0 configured, then run:

```bash
node scripts/benchmark-execution.mjs \
  --base-url http://localhost:8081 \
  --language javascript \
  --warmup 5 \
  --runs 100 \
  --concurrency 4 \
  --output execution-benchmark.json
```

The backend defaults to 10 execution submissions per user and room each minute. Raise `EXECUTION_RATE_LIMIT_PER_MINUTE` for a controlled local benchmark instead of bypassing the limit with multiple identities.

The report separates:

- client-observed completion time;
- server lifecycle time from `createdAt` to `completedAt`;
- Judge0-reported program runtime;
- approximate orchestration overhead.

Judge0 polling starts at `JUDGE0_INITIAL_POLL_INTERVAL` (100 ms by default) and backs off exponentially to
`JUDGE0_POLL_INTERVAL` (750 ms by default). This reduces completion latency for short programs without applying
the fastest polling rate throughout the execution deadline.

Run benchmarks against a warmed deployment and record the environment, Judge0 provider, language, run count, concurrency, and date. Free-tier cold starts should be reported separately rather than removed without explanation.

## Recovery benchmark

Start the repository Redis service, then run:

```bash
cd backend
mvn -Dtest=ExecutionRecoveryBenchmark test
```

The benchmark claims 100 jobs as crashed workers, waits for their leases to expire, executes the Redis recovery path, and verifies that replacement workers can reclaim every job. It reports p50, p95, p99, and maximum time from the simulated crash to requeue.

Its defaults match the application configuration:

- 6-second worker lease;
- 1-second recovery scan;
- 100 abandoned jobs.

Override them when evaluating a proposed configuration:

```bash
BENCHMARK_LEASE_MS=5000 \
BENCHMARK_RECOVERY_SCAN_MS=500 \
mvn -Dtest=ExecutionRecoveryBenchmark test
```

This benchmark claims every job and never renews it, so it measures the worst case: a worker that dies right after renewing its lease. [bench/execution-crash.mjs](../bench/execution-crash.mjs) measures the same path with real backend processes killed mid-run; results are in [performance.md](performance.md).

## Leases and the execution deadline

A worker renews its lease every third of the lease duration from a background heartbeat, including while it is blocked in a provider call. Wandbox runs code inside one HTTP request that can take up to 12 seconds plus retries, so without the heartbeat the lease would have to outlast the slowest request, and a crashed worker's job would not be noticed until after its 20-second deadline.

Keep `EXECUTION_WORKER_LEASE` plus `EXECUTION_WORKER_RECOVERY_INTERVAL` well under `JUDGE0_EXECUTION_DEADLINE`; the backend logs a warning at startup when they are not. Do not describe lease duration plus scan delay as successful execution recovery on its own: a recovered job must still finish before its execution deadline, which the crash test checks.
