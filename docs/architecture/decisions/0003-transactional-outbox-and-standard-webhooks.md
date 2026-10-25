# 0003. Deliver alerts through a transactional outbox as Standard Webhooks

Status: accepted

## Context

An alert must be sent if and only if the incident change that caused it committed, and delivery to someone else's endpoint can fail or be slow.

## Decision

Alerts are written to an `outbox` table in the same transaction as the incident change, one row per active endpoint, each with a unique message id. A scheduled drain claims due rows with `FOR UPDATE SKIP LOCKED` and a 5-minute lease, delivers outside any transaction, and marks them sent or schedules a retry (backoff 1, 2, 4 … 60 min). Payloads follow the Standard Webhooks spec (`webhook-id`, `webhook-timestamp`, `webhook-signature`), with a Slack-format option. Deliveries never follow redirects.

## Alternatives considered

- **Send directly from the probe handler**: An alert could go out for a transaction that later rolls back, or be lost if the process dies after commit.
- **Slack-only alerts**: Simple, but not a general integration point and cannot be signed.
- **A pull feed (`GET /v1/events`)**: No push latency guarantees; every consumer must poll.

## Consequences

- Delivery is at least once: a crash between sending and marking sent redelivers with the same `webhook-id`; receivers deduplicate on it.
- Alert latency is bounded by the drain cadence (15 minutes as deployed).
- An endpoint is disabled after 10 consecutive failures; its pending messages wait until it is re-enabled.
