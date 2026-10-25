# 0006. Classify JSON Schema changes deny-by-default

Status: accepted

## Context

Agents see a tool's input schema as instructions. A change can break callers (a removed property, a type change) or be harmless (a new optional property). JSON Schema has dozens of keywords, and a classifier that misses one can hide a rug pull.

## Decision

Allow-list what is safe, treat everything else as breaking: equal → unchanged; `description`, `title`, `default`, `examples` → compatible; new optional property → compatible; removed property → breaking; `enum` values only added → compatible, any removed → breaking; recurse into `properties` and `items`; any other keyword change (`type`, `required`, `additionalProperties`, combinators, `$ref`, constraints) → breaking.

## Alternatives considered

- **Deny-list known breaking keywords**: Smaller rule set, but an unfamiliar keyword would pass silently.

## Consequences

- No unknown change is ever classified safe.
- Some harmless changes (loosening a `minimum`, dropping a `required` entry) alert as critical.
- A changed parameter description inside the schema is compatible today, although agents read it like a tool description; that is a known gap.
