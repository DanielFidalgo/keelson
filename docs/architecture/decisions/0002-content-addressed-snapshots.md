# 0002. Store snapshots content-addressed by a canonical hash

Status: accepted

## Context

Most probes return exactly what the previous probe returned. Storing every catalog wastes space, and comparing catalogs field by field on every probe is slow and error-prone.

## Decision

Reduce each catalog to the watched fields, canonicalise it (identity-sorted lists in UTF-16 code-unit order, recursively sorted keys, `required` and `enum` as sets, normalised empties), and identify it by `sha256` of the canonical JSON. `snapshots` is keyed by that hash and inserted with `ON CONFLICT DO NOTHING`.

## Alternatives considered

- **Store every probe's full catalog**: Simple, but grows with every probe and still needs a diff per probe.
- **Store only diffs**: Smaller, but reconstruction and baseline approval become complicated.

## Consequences

- An unchanged server writes nothing but a probe row; drift detection starts with a hash comparison.
- Canonicalisation must be exactly right: an unstable order would create false drift. It is pinned by tests and avoids locale-dependent sorting.
- Only watched fields are hashed, so changes to unwatched fields (tool `title`, `annotations`, `outputSchema`, prompt arguments) are invisible until they are added.
- Snapshots are shared across tenants (same content, same hash) and only reachable through a tenant's own monitors.
