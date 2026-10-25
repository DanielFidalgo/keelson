# 0007. Keep the GCP footprint close to zero cost

Status: accepted

## Context

The first deployment billed each Cloud Run service for its whole lifetime: with resource limits set, CPU stayed allocated, and a per-minute scheduler never let instances idle.

## Decision

Request-based billing (`cpuIdle`), scale to zero, dispatch on the quarter hour with the drain one minute later so the free-tier database can suspend, and Artifact Registry retention capped to the last 3 images per app.

## Alternatives considered

- **Always-on minimum instances**: No cold starts, steady cost.
- **Per-minute dispatch**: Lower detection latency, keeps the database awake.

## Consequences

- Effective probe floor is 15 minutes although the API accepts 300 s.
- Detection and alert latency up to about 16 minutes; delivery retries are quantised to the drain cadence.
- Cold starts of about 10 s after idle.
- A 3-image rollback window.
