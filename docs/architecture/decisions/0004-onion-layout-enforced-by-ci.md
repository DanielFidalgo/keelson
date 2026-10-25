# 0004. Enforce the onion layout in CI, not by convention

Status: accepted

## Context

Layered architectures erode one convenient import at a time, and the most important boundary here is a security one: the public api must never dial an untrusted host.

## Decision

Separate workspaces for `domain`, `application`, `infrastructure` and `apps`, with TypeScript project references for build order, and seven dependency-cruiser rules run in CI: pure domain, application depends on domain only, infrastructure never imports apps, the api cannot import egress code (only reachable through the `@keelson/infrastructure/egress` subpath), DI containers only in composition roots, the shared MCP HTTP package only from apps, no cycles. A script proves four of the rules fail when violated.

## Alternatives considered

- **Convention and code review**: Cheap, but reviewers miss transitive imports, and the egress boundary is too important to leave to review.
- **Separate repositories per layer**: Strong isolation, far too much overhead for one product.

## Consequences

- Boundaries fail the build instead of drifting.
- Project references alone do not forbid an import (workspaces link everything); dependency-cruiser is the real fence.
- Three rules have no negative test yet.
