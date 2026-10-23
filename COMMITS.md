# Commit log

What each commit changed and why, newest first. An entry is written in the same commit it describes, so its hash is filled in by the commit after it (`pending` until then).

## pending: feat(infrastructure): add SSRF-guarded MCP inspector, webhook channels and demo server

Adds the code that touches untrusted URLs: a guarded `fetch` that connects only to addresses that passed the policy check, so DNS rebinding and redirects cannot reach internal hosts, the MCP inspector built on the v2 SDK client with a 10 s probe budget and a 50 page cap, the Standard Webhooks and Slack alert channels, and a demo MCP server (with an inspector contract test against it) whose tool description can be changed on cue for the rug-pull demo. All of it is exported only from `@keelson/infrastructure/egress`, and the dependency rule now bars `apps/api` from that entry, with a script that proves the rule fires. Webhook deliveries never follow redirects: a 3xx is a failed delivery, since following one would replay the signed POST as a bodyless GET.

## b6aee8c: feat(infrastructure): add Postgres repositories, outbox and migrations

Adds the Postgres adapters for every persistence port, each unit of work running in one transaction, and the first migration as a node-pg-migrate SQL file. Dispatch and outbox claims use `FOR UPDATE SKIP LOCKED`, so concurrent workers never take the same row. There is no foreign key from probes to snapshots, so the probe row can be written before its snapshot in the same transaction.

## 118baf2: docs(plan): use node-pg-migrate and awilix dependency injection

Migrations move to node-pg-migrate with plain SQL files (`NNNN_<what>.sql`, a header comment saying why, idempotent DDL), replacing a hand-written runner. Dependency injection uses awilix in PROXY mode, wired only in each app's `container.ts`, so the domain and application layers stay library-free. Adds this commit log.

## f3f859e: feat(application): add monitor, baseline, webhook, outbox and tenant use cases

Completes the application layer: register, update and delete monitors (registration rejects anything that is not an MCP server and stores nothing), approve a baseline, acknowledge incidents, manage webhook endpoints, create tenants with hashed API keys, and drain the outbox with backoff and endpoint disabling after 10 failures. Read queries are tenant-scoped. The domain gains rescheduling on interval change and webhook endpoint updates.

## c282361: feat(application): add ports and the dispatch and probe use cases

Defines every port the use cases need, plus in-memory implementations under `@keelson/application/testing`. `DispatchDueProbes` enqueues one job per due monitor per slot. `RunProbe` inspects a server, snapshots it, assesses health and writes the probe, incidents and alert outbox rows in one transaction; a retried job for the same slot records nothing twice.

## c32d165: feat(domain): assess probe health and model incidents, alerts and webhook endpoints

`assessProbe` is a pure state machine: first `up` sets the baseline, 3 consecutive failures open a `down` incident, a new snapshot opens or escalates a `drift` incident, and a drift that stays in place produces no new alert. Adds incidents, alert records, webhook endpoints with delivery backoff, and shared validation.

## 4c4f71e: docs(plan): identify resources by uri and dedupe enums in canonical form

Keeps the rule that two snapshots differ exactly when there is a change to report: a resource is identified by its `uri` only, and every `enum` is sorted and deduplicated.

## e802c0d: feat(domain): classify drift between snapshots

`computeChanges` lists added and removed tools, prompts and resources, description changes (the rug-pull signal, always critical) and input schema changes classified as breaking or compatible by diffing JSON Schema.

## 1b8452e: feat(domain): add canonical snapshots, monitors and probe slots

Canonicalises a server's catalog (sorted, irrelevant fields dropped) and hashes it with sha256, so an unchanged server writes nothing. Adds monitors with a 300 s minimum interval and time slots that make each probe idempotent.

## 26defc0: build: scaffold onion monorepo with CI and dependency rule

npm workspaces for `packages/{domain,application,infrastructure}` and the apps, TypeScript 6 project references, Vitest, ESLint, and dependency-cruiser rules that fail CI if a layer imports outward.

## 391907b: docs(plan): add Keelson implementation plan

Fifteen test-first tasks, from scaffold to deployment, ordered so the end-to-end rug-pull path lands first.

## 82db2c6: docs(spec): switch alerts to signed webhooks and close registration, escalation and SSRF gaps

Alerts become signed webhooks (Standard Webhooks) with a Slack format. Registration probes through the worker, escalation happens only on a new hash, tenants get an admin command, and probes connect to the address that passed the SSRF check.

## dbc3729: docs(spec): add Keelson design

The design: what Keelson monitors, its domain language, architecture, data flow, data model, API, security and scaling path.
