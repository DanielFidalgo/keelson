# 0001. Fan out probes with Cloud Tasks and named tasks

Status: accepted

## Context

Probes must run on a schedule for every active monitor, be retried when Keelson itself fails, never run twice for the same slot, and cost nothing when idle.

## Decision

Cloud Scheduler calls a dispatcher endpoint; the dispatcher claims due monitors with `FOR UPDATE SKIP LOCKED` and creates one Cloud Task per monitor named `probe-{monitorId}-{slot}`. Cloud Tasks delivers to the worker with an OIDC token, retries with backoff (5 attempts, 10 s to 300 s), and enforces queue-wide rate and concurrency limits (5/s, 20 concurrent).

## Alternatives considered

- **Pub/Sub fan-out**: Higher throughput, but no per-message names to deduplicate on and no queue-level rate limits; both would have to be rebuilt. Kept as the path past ~100k monitors.
- **In-process scheduler in one long-running worker**: Simplest, but cannot scale out, cannot scale to zero, and loses work on restart.
- **Database-polling workers**: Workable, but reimplements retries, backoff and rate limits that Cloud Tasks provides.

## Consequences

- A duplicate dispatch is harmless: Cloud Tasks rejects an existing name (`ALREADY_EXISTS` is treated as success).
- Cloud Tasks has no dead-letter queue. The worker logs `probe.retries_exhausted` on the final attempt and a log-based alert fires; crashes on the final attempt are not covered.
- Rate limits are global per queue, not per probed host.
- Enqueueing happens inside the claiming transaction, which holds row locks for the whole batch (see Limits in the architecture document).
