# 0009. Use Postgres, hosted on Neon, configured by URL

Status: accepted

## Context

State is relational, and the correctness design relies on database constraints (unique per slot, partial unique open incident, unique outbox key) and row locks.

## Decision

Postgres everywhere: Testcontainers in tests, Docker locally, Neon in production. The connection string comes from Secret Manager as `DATABASE_URL`, so the database is a swappable attached resource.

## Alternatives considered

- **Cloud SQL**: Closer to the rest of the stack and private networking, about 10-15 USD/month at the smallest size.
- **Firestore**: Serverless and free at this size, but no relational constraints or `SKIP LOCKED`; idempotency would move into application code.

## Consequences

- Free tier with autosuspend: the first query after idle is slow.
- No HA or point-in-time-recovery commitment on the free plan.
- The api needs internet egress to reach it (see ADR 0005).
