# 0005. Run all untrusted network calls in a separate worker service

Status: accepted

## Context

Probing user-supplied URLs and delivering to user-supplied webhooks is the riskiest thing Keelson does. A bug there should not sit in the same process as the public API and its credentials.

## Decision

Two Cloud Run services. The public `api` handles requests and dispatch; the IAM-gated `worker` is the only process that dials monitored servers and alert endpoints, always through the SSRF-guarded fetch. Registration-time inspection goes api → worker over OIDC.

## Alternatives considered

- **One service**: Simpler and cheaper, but untrusted egress shares a process and identity with the public surface.
- **Network-level egress restriction on the api**: Stronger, but the api needs internet egress to reach the hosted database; it would require a VPC connector and private database networking.

## Consequences

- Probing scales independently of API traffic.
- The "only the worker dials untrusted hosts" rule is enforced by code structure (ADR 0004), not by network policy.
- Registration costs one extra internal hop.
