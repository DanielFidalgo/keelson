# Keelson: design

Date: 2026-10-22
Status: approved in conversation, pending written review

## Purpose

Keelson watches remote MCP servers and tells you when they break or change under you.

Teams that let AI agents call third-party MCP servers depend on things they don't control: the server can go down, a tool can disappear, a parameter can be renamed, or a tool's description can change after a human approved it (a "rug pull", where new instructions are injected into the agent's context). Keelson probes each server on a schedule, snapshots its tools, prompts and resources, compares them with an approved baseline, and raises one deduplicated alert per problem.

- **Users:** engineers and platform teams who connect agents to MCP servers they don't own, and teams who host MCP servers and want an outside view of them.
- **Success:** a registered server is probed on schedule; an outage, a schema change or a description change produces exactly one alert within one probe interval; the drift is shown as a readable diff and can be approved as the new baseline.

## Scope

| In (first release) | Out (designed for, not built) |
|---|---|
| Monitors for remote MCP servers over Streamable HTTP | stdio transport (a hosted service cannot spawn local processes) |
| Scheduled probes: handshake, list tools, prompts, resources | Calling tools on the probed server |
| Content-addressed snapshots, drift detection and classification | Billing and plans |
| Incidents for outages and unapproved drift, one alert each | Teams, roles, SSO |
| Alerts as signed webhooks (Standard Webhooks), with a Slack format | Pub/Sub fan-out for very large fleets |
| REST API (`/v1`), OpenAPI-first | Probing from several regions |
| Dashboard (Vue 3 + Vite): monitors, probe history, drift diffs, incidents | Custom alert routing rules, email |
| Keelson's own MCP server (read-only queries over its data) | |
| GCP deployment as code (Pulumi, TypeScript), CI/CD | |

## Domain language

These names are used verbatim in code.

- **Monitor:** one watched MCP server: name, URL, transport, reference to an auth secret, probe interval, approved baseline snapshot, status (active, paused).
- **Probe:** one execution against a monitor in one time **slot** (`floor(now / interval)`): outcome (`up`, `timeout`, `connection_error`, `protocol_error`, `auth_error`), latency, server name and version, snapshot hash when up.
- **Snapshot:** the server's tools, prompts and resources in canonical form (sorted by name, object keys sorted, irrelevant fields dropped), identified by the sha256 of that canonical JSON. Immutable.
- **Drift:** the differences between a snapshot and the monitor's baseline, each a **change**:
  - `tool_added`, `tool_removed`, `prompt_added`, `prompt_removed`, `resource_added`, `resource_removed`
  - `input_schema_changed`, classified `breaking` (property removed, type changed, property newly required, enum value removed) or `compatible` (optional property added, description-only change inside the schema)
  - `description_changed` on a tool or prompt: severity `critical` (rug-pull signal)
- **Severity:** `critical` (description changed, tool removed, breaking schema change), `warning` (tool added, compatible schema change). A server version change with an identical snapshot is recorded on the probe only: no drift, no alert.
- **Incident:** an open problem on a monitor, of kind `down` (3 consecutive non-`up` probes) or `drift` (a snapshot differing from the baseline). At most one open incident per monitor and kind. Resolved by recovery (`down`), by approving a baseline (`drift`), or by the server reverting to its baseline (`drift`, resolved as reverted).
- **Approval:** promoting a snapshot to a monitor's baseline. The first successful probe of a new monitor becomes its baseline automatically.
- **Alert:** a notification about an incident being opened, escalated (new changes on an open drift incident) or resolved.
- **Webhook endpoint:** a tenant's URL that receives alerts, in one of two formats: `standard` (JSON event signed per the Standard Webhooks specification) or `slack` (a message for a Slack incoming webhook). Status `active` or `disabled`.
- **Delivery:** one alert sent to one webhook endpoint, retried until it succeeds or the endpoint is disabled.

## Architecture

Onion layout in a TypeScript monorepo (npm workspaces, TypeScript project references). Dependencies point inward only, enforced in CI.

```
packages/
  domain/          entities, value objects, canonicalisation, hashing, drift classification,
                   incident state machine. Imports nothing outside itself.
  application/     use cases + the ports they need. Imports domain only.
  infrastructure/  adapters implementing the ports. Imports application and domain.
apps/
  api/             Cloud Run service: REST API, Keelson MCP server, /internal/dispatch, and the
                   built dashboard as static files; the `create-tenant` admin command.
                   Composition root for its own adapters.
  worker/          Cloud Run service: /internal/probe, /internal/inspect, /internal/outbox/drain. The only service
                   with internet egress (it reaches probed servers and webhook endpoints).
  dashboard/       Vue 3 + Vite single-page app over the /v1 API.
  demo-server/     a small MCP server whose tool description can be changed on purpose
                   (used for end-to-end tests and demonstrations).
infra/             Pulumi (TypeScript): Cloud Run, Cloud Scheduler, Cloud Tasks, Secret Manager,
                   service accounts, IAM. Postgres is Neon, passed as DATABASE_URL from Secret Manager.
```

**Use cases (application):** `RegisterMonitor`, `UpdateMonitor`, `DispatchDueProbes`, `RunProbe`, `ApproveBaseline`, `AcknowledgeIncident`, `RegisterWebhookEndpoint`, `DrainOutbox`, plus queries for monitors, probes, snapshots, drift and incidents.

**Ports (application):** `MonitorRepository`, `ProbeRepository`, `SnapshotStore`, `IncidentRepository`, `WebhookEndpointRepository`, `Outbox`, `ProbeQueue`, `McpInspector` (connect and list), `SecretStore`, `AlertChannel`, `Clock`, `UnitOfWork` (one transaction across repositories).

**Adapters (infrastructure):** Postgres repositories and outbox, Cloud Tasks queue, MCP inspector on the official TypeScript MCP SDK client (used by `worker`) and an inspector that calls `worker`'s `/internal/inspect` (used by `api`), Secret Manager, two alert channels (Standard Webhooks sender, Slack formatter) over one HTTP delivery client, system clock; in-memory versions of every port for tests and local development.

## Data flow: one probe

1. **Schedule.** Cloud Scheduler calls `POST /internal/dispatch` on `api` every minute with a Google-signed OIDC token.
2. **Dispatch.** `DispatchDueProbes` selects active monitors with `next_probe_at <= now` using `FOR UPDATE SKIP LOCKED` (a second dispatcher cannot take the same rows), enqueues a Cloud Task named `probe-{monitorId}-{slot}` per monitor (a duplicate name is rejected by Cloud Tasks, so a monitor is never probed twice in one slot), and advances `next_probe_at` to the next slot.
3. **Probe.** Cloud Tasks calls `POST /internal/probe` on `worker` (OIDC), within the queue's rate and concurrency limits, retrying with backoff on failure. `RunProbe` loads the monitor and its secret, then the inspector connects, runs `initialize`, and lists tools, prompts and resources (following pagination), inside a 10 s total budget. The probe is stored with a unique `(monitor_id, slot)`, so a retried task cannot record two probes.
4. **Snapshot and drift.** On `up`, the result is canonicalised and hashed; the snapshot is inserted only if the hash is new. If the hash equals the baseline, an open `drift` incident is resolved as reverted. If it differs, the domain computes the drift against the baseline and opens the monitor's `drift` incident, or escalates the open one only when the hash differs from its last drift's `to_hash`; a drift that stays in place records nothing new and sends no alert. The probe, snapshot, incident change and outbox rows are written in one transaction.
5. **Outages.** Each non-`up` outcome increments a consecutive-failure count; the third opens a `down` incident; the next `up` resolves it.
6. **Alerts.** Opening, escalating or resolving an incident writes one outbox row per active webhook endpoint of the tenant, in the same transaction. `DrainOutbox` on `worker` (called by Cloud Scheduler every minute, OIDC) sends due rows through the endpoint's format and marks them sent. A `standard` delivery carries `webhook-id` (the row's idempotency key), `webhook-timestamp` and `webhook-signature` (HMAC-SHA256 with the endpoint's secret), so receivers verify origin and drop duplicates. Delivery is at least once.

**Invariant:** every step can be retried safely; correctness never depends on something running exactly once.

## Data model (Postgres)

| Table | Key columns | Constraints and indexes |
|---|---|---|
| `tenants` | id, name | |
| `api_keys` | id, tenant_id, key_hash, created_at, revoked_at | only the hash is stored; created by `create-tenant`, which prints the key once |
| `monitors` | id, tenant_id, name, url, transport, auth_secret_ref, interval_seconds, next_probe_at, baseline_hash, consecutive_failures, status | index on `next_probe_at` where `status = 'active'`; interval ≥ 300 s |
| `probes` | id, monitor_id, slot, started_at, latency_ms, outcome, error_detail, server_name, server_version, snapshot_hash | unique `(monitor_id, slot)`; index `(monitor_id, started_at desc)` |
| `snapshots` | hash, canonical (jsonb), first_seen_at | primary key `hash`; reachable only through a tenant's monitors |
| `drifts` | id, monitor_id, from_hash, to_hash, changes (jsonb), max_severity, detected_at | |
| `incidents` | id, monitor_id, kind, state, opened_at, resolved_at, acknowledged_at, last_drift_id | partial unique index on `(monitor_id, kind)` where `state = 'open'` |
| `webhook_endpoints` | id, tenant_id, url, format, secret_ref, status, consecutive_failures, created_at | `format` in (`standard`, `slack`); signing secret in Secret Manager |
| `outbox` | id, incident_id, endpoint_id, payload, idempotency_key, attempts, next_attempt_at, sent_at | unique `idempotency_key`; index on `next_attempt_at` where `sent_at is null` |

Migrations are versioned SQL files applied on deploy.

## API

All routes under `/v1`, authenticated with a tenant API key (`Authorization: Bearer`), JSON, cursor pagination. The OpenAPI document is the source of truth and is served with an interactive reference. Tenants and their first API key are created by the `create-tenant` admin command, run as a one-off process (a Cloud Run job) against the same database.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/monitors` | register (validates the URL and asks `worker`'s `/internal/inspect` for a dry-run probe that stores nothing; rejects servers that are not MCP) |
| GET | `/v1/monitors` | list |
| GET, PATCH, DELETE | `/v1/monitors/{id}` | read, update (interval, name, status, secret), delete |
| GET | `/v1/monitors/{id}/probes` | probe history |
| GET | `/v1/monitors/{id}/snapshots/{hash}` | one snapshot |
| GET | `/v1/monitors/{id}/drift` | current drift against the baseline |
| POST | `/v1/monitors/{id}/baseline` | approve a snapshot (`{ "snapshotHash": ... }`) |
| GET | `/v1/incidents?state=open` | incidents |
| POST | `/v1/incidents/{id}/ack` | acknowledge |
| POST, GET | `/v1/webhook-endpoints` | register (returns the signing secret once), list |
| GET, PATCH, DELETE | `/v1/webhook-endpoints/{id}` | read, update (url, status), delete |

Internal routes (`/internal/dispatch`, `/internal/probe`, `/internal/inspect`, `/internal/outbox/drain`) accept only OIDC tokens from Keelson's own service accounts.

**Keelson MCP server** (on `api`, Streamable HTTP, API key auth, read-only tools): `list_monitors`, `get_drift`, `list_open_incidents`.

## Security

- **Server-side request forgery.** Monitor and webhook endpoint URLs come from users; both go through the same guard. The worker resolves the host and refuses private, loopback, link-local and metadata addresses (including `169.254.169.254`), re-checking after redirects. The connection goes to the address that passed the check, so DNS rebinding (a second lookup returning a private address) cannot bypass it. Only `https` is accepted outside local development.
- **Egress.** Only `worker` reaches the internet (probes and webhook deliveries); `api` has no need to.
- **Secrets.** Monitor auth secrets and webhook signing secrets live in Secret Manager; the database stores a reference. API keys are stored hashed.
- **Probed servers' content is untrusted.** Tool descriptions are stored and displayed escaped, never interpreted.
- **Politeness.** Probes only list; they never call tools. Minimum interval 300 s; per-host concurrency limited by the queue; a `User-Agent` identifies Keelson and links to a page explaining the probes.

## Errors

| Failure | Handling |
|---|---|
| Probed server down, slow, 5xx, invalid MCP | Recorded as the probe outcome; not retried (the failure is the data) |
| Keelson's own dependency fails (database, Secret Manager) | The request fails; Cloud Tasks retries with backoff; the unique `(monitor_id, slot)` keeps retries safe; after the last attempt the task goes to a dead-letter queue, which alerts |
| Invalid input at registration | `400` with every problem listed; nothing stored |
| Webhook delivery fails (non-2xx, timeout) | Outbox row stays pending, `attempts` increments, `next_attempt_at` backs off exponentially; after 10 consecutive failures the endpoint is `disabled` until re-enabled through the API |

Logs are structured JSON on stdout (Cloud Logging), each line carrying the trace id, monitor id and slot where relevant. Every probe's outcome and latency are recorded; a probe's handling never logs secrets or full tool payloads.

## Configuration

All configuration from environment variables (twelve-factor): database URL, GCP project, queue name, service URLs, allowed-URL policy. Webhook endpoints are tenant data, not configuration. Nothing environment-specific in code. Local development runs the same apps against Postgres in Docker and in-memory queue and clock.

## Testing

- **Domain:** unit tests for canonicalisation (order and irrelevant fields do not change the hash), hashing, every drift change kind and its severity (fixture pairs of tool lists), and the incident state machine.
- **Application:** use-case tests with in-memory adapters and a fixed clock: dispatch idempotency, probe retry safety, three-failure `down`, recovery, approval resolving drift, a drift that stays in place sending no second alert, outbox drain, delivery backoff and endpoint disabling.
- **Infrastructure:** Postgres adapter tests against a disposable database; SSRF guard tests; MCP inspector tests against `demo-server`; webhook signature tests against the Standard Webhooks test vectors.
- **End to end:** register the demo server and a local webhook receiver, probe, change its tool description, probe, assert one `critical` drift incident and one signed delivery.
- **CI:** typecheck, lint, tests, the dependency-direction rule, `pulumi preview` on pull requests; deploy on `main`.

## First monitored servers

Public, read-only, no authentication (checked 2026-10-22 with an `initialize` request): DeepWiki (`https://mcp.deepwiki.com/mcp`), Microsoft Learn (`https://learn.microsoft.com/api/mcp`), Cloudflare Docs (`https://docs.mcp.cloudflare.com/mcp`), Context7 (`https://mcp.context7.com/mcp`), Hugging Face (`https://huggingface.co/mcp`), plus Keelson's own `demo-server`.

## Scaling path (documented, not built)

- **Dispatch at 100k monitors:** shard the dispatcher by monitor id range; move fan-out to Pub/Sub, carrying the idempotency the task names give today into the `(monitor_id, slot)` constraint.
- **Probe history volume:** partition `probes` by month; keep raw rows 90 days, roll up latency and uptime per day.
- **Regional probing:** one worker deployment per region, probes tagged with region, `down` requiring agreement from more than one region.
- **Noisy neighbours:** per-tenant quotas on monitor count and minimum interval.
