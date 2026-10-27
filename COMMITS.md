# Commit log

What each commit changed and why, newest first. An entry is written in the same commit it describes, so its hash is filled in by the commit after it (`pending` until then).

## fe695d7: fix(api): seal the new tenant's API key instead of logging it

On Cloud Run the create-tenant job's stdout goes to Cloud Logging, so printing the API key there left a working credential readable by everyone with log access. The command now takes `--recipient-key` (a base64 DER RSA public key of at least 2048 bits), prints the key encrypted to it (OAEP with sha256), and refuses to print it in plain text when stdout is not a terminal. The refusal happens before the tenant is created, so a missing key leaves nothing behind. Operators on the deployed system pass their public key in the job arguments and decrypt the logged value with the command in the README; a local run in a terminal still prints the key as before.

## 0c48a6e: fix(network): cap response bodies in the guarded fetch

The guarded fetch read whatever a monitored server sent, so a hostile or broken server could stream an unbounded body into memory. Responses are now capped at 4 MiB: a `content-length` above the cap is refused before any of the body is read, and a body that outgrows it while streaming errors with `ResponseTooLargeError` instead of being truncated. A probe or alert delivery against an oversized response now fails with that error, and normal tools/list responses are far below the cap.

## f699b67: fix(alerting): escape Slack control characters in alert text

Monitor, tool, prompt and resource names and URIs come from monitored servers, and Slack reads `<!channel>` or `<url|label>` in a message as a mention or a disguised link. An alert's text now escapes `&`, `<` and `>`, so those values show literally. Every run of line breaks inside one of those values is also replaced by a single space, so a server can no longer forge extra `- ...` lines or a second `Keelson:` headline inside a real alert. Names containing these characters now look slightly different in Slack, and nothing else about the alert changes.

## b6fcaf6: feat(dashboard): show description drift as a word-level diff

A changed tool description used to show both full texts, which hid a one-word edit in a wall of text (a real Perplexity Docs drift on 2026-10-25 changed only a spec path and the order of a list). The drift view now diffs line by line, highlights only the words that changed, and collapses unchanged lines behind a toggle. No new dependency.

## 8b59ef1: fix(dashboard): keep views fresh and consistent before the walkthrough

The monitor page now reloads every minute like the history table beside it and has a Refresh button, and a failed refresh keeps the data under an error banner; lists do the same instead of emptying, showing the full error only when nothing had loaded. The row menu focuses its first item without scrolling, so opening it can no longer close it.
Display labels moved to one module and acknowledged incidents read the same on Overview and Incidents. The run, toast, refresh and nav-count sequence became `useAction`, which also disables the buttons while an action runs (no more double Disable or Delete on Webhooks), and the unused `change` and `busy` left `useLoadedData`.

## b7d8ffb: feat(dashboard): add incidents, webhooks and overview pages

Incidents now has Open, Acknowledged and Resolved tabs with counts (sent to the API as `state` and `acknowledged`) and a kind filter; resolved incidents show how they ended (Recovered, Approved or Reverted) and how long they lasted, and Acknowledge appears only on open, unacknowledged rows. Webhooks lists endpoints showing only the scheme and host of their URL, and adds, enables, disables and deletes them (behind a confirmation); the signing secret is shown once in a copyable box inside the add dialog and is kept nowhere else.
Overview shows four counters that link to the filtered monitors, the five latest open incidents (acknowledged ones marked) and the down and drifted monitors, and reloads every minute. `useListQuery` gained `refreshAfterChange`, so actions on the last row of a page step back instead of leaving it empty, and the 400 problem list moved to `describeProblems`, shared by both Add dialogs.

## 6320a80: feat(dashboard): add the monitor detail page with stats, drift, history, snapshot and settings

The monitor page now has a breadcrumb, Pause or Resume and Approve new baseline (enabled only when drifted, through the same confirmation as the list), stat cards (24 h uptime, p95, interval, baseline hash) and four tabs kept in the query string: Drift as change cards, a paginated Probe history, the baseline's Snapshot, and Settings (rename, interval, replace or clear the token, delete behind a confirmation).
Everything probed is rendered as text under a banner saying it is data, never instructions. The interval select moved out of the Add dialog so Settings shares it, and every action toasts, reloads the page and refreshes the sidebar counts.

## 8fd89fe: feat(dashboard): add the monitors console with filters, actions and pagination

The Monitors page now searches (debounced, in the URL), filters by health with live counts (Pending only when non-zero), and offers a row menu: Review drift and Approve new baseline only for drifted monitors, Probe history, Pause or Resume, and Delete behind a confirmation naming the monitor. Add monitor takes name, URL, an interval of 5, 15, 30 or 60 minutes (sent as seconds) and an optional bearer token, and lists every problem the API reports.
Approving first reads the monitor's drift, shows the change count, highest severity and target hash, and approves exactly that hash. Every action toasts, refreshes the list and the sidebar counts, and deleting or pausing the only row of the last page steps back a page instead of leaving it empty.

## acec191: feat(dashboard): add the Scalar-themed shell and shared list behaviour

The dashboard now wears the Scalar API Reference dark theme (its tokens as CSS custom properties, system font stacks) inside a sidebar shell with live counts, and its API client covers every operation, with paged methods returning the page and its `total`.
Every list shares `useListQuery` (filters, page, size and cursor in the URL, a cursor stack for Previous, a refresh that only ticks while the tab is visible), `DataList` (skeleton, empty and error states) and `ListPagination`, next to `StatusPill`, `LatencySparkline`, `ConfirmDialog`, toasts and relative times. The Monitors and Incidents pages are minimally adapted to them until the page tasks replace them.

## c2fbf92: feat(api): expose dashboard read models: health, summaries, stats, counts and totals

`GET /v1/monitors` and `GET /v1/monitors/{id}` now return each monitor with a `summary` (health, latest probe, recent latencies, tool count, open incident); the list takes `health` and `q` (at most 100 characters, a longer one is a 400) and every list response carries a `total`. New read-only operations: `GET /v1/monitors/health-counts`, `GET /v1/monitors/{id}/stats` and `GET /v1/incidents/counts`; `GET /v1/incidents` takes `kind` and `acknowledged` and returns `monitorName` and `severity` per item.
Existing parameters and fields are unchanged, and `schema.d.ts` is regenerated from the contract. A test pins the YAML's health enum and search length to `HEALTH_STATES` and `SEARCH_MAX_LENGTH`, since the spec is read as a file and cannot import them.

## 8b77001: feat: add monitor and incident read models for the dashboard

`MonitorDirectory` and `IncidentDirectory` are new read-side ports with in-memory and Postgres adapters, so the dashboard can list monitor summaries (health, latest probe, recent latencies, tool count, open incident), health counts, 24 h probe stats, and incident views and counts with filters. The Postgres health is one `CASE` expression shared by listing, filtering and counting, and a parity test runs it over `HEALTH_STATE_CASES`; search escapes `%`, `_` and `\` so they match literally.
Probe and webhook endpoint listings now return a `total` (`CountedPage`) alongside the page.

## 693edda: feat(domain): derive a monitor's health from status, probes and open incidents

`healthStateOf` is the single rule for a monitor's health (`paused`, `down`, `drift`, `pending`, otherwise `up`, first match wins), so the read models, API and dashboard never re-derive it. `HEALTH_STATE_CASES` is the shared precedence table the Postgres filter's parity test will reuse. The plan and spec rename to `HealthState` ships with it.

## af9063e: docs(plan): add the dashboard redesign plan

Eight test-first tasks: the domain health rule, application read models, their Postgres queries, the API contract, then the dashboard shell and its Monitors, Monitor detail, Incidents, Webhooks and Overview pages.

## 0e736ca: docs(spec): add the dashboard redesign design

A dark console in Scalar's own theme with pagination, filtering, search and every API action, backed by read-only API additions (health summaries, stats, counts and totals). Includes the calls made after a builder review.

## 9a846fc: chore(seed): add 14 verified public MCP servers to the seed list

Adds Scalar's own documentation MCP (`https://scalar.com/mcp`), GitMCP for `scalar/scalar`, the MCP spec site and SDK, AWS Knowledge, and docs servers for Mintlify, Resend, Perplexity, LangChain, Together AI, Firecrawl, Astro and Svelte, plus Exa. Each answered an MCP initialize without credentials on 2026-10-25; servers that needed auth or redirected were left out.

## a76a605: chore: keep local GitNexus agent files out of the repo

`npx gitnexus analyze` writes `AGENTS.md`, `CLAUDE.md` and `.claude/skills/` into the repository root. They are local agent guidance, so they stay untracked for now.

## e9f2c7a: fix(infra): keep the GCP footprint at zero cost

Cloud Run billed each service for its whole lifetime: with resource limits set, `cpuIdle` defaults to false, and the per-minute scheduler never let an instance go idle (about 145 dollars a month). Services now bill per request. Dispatch runs on the quarter hour and drain one minute later, so the free Neon compute can sleep in between (about 73 of 100 free CU-hours a month), and Artifact Registry keeps only the last 3 images per app to stay inside the free 0.5 GB.

## 640a356: refactor: group package sources by domain concept

The domain, application and infrastructure sources sat in flat folders, so a concept's code was scattered across files with nothing tying them together. They are now grouped by domain concept (monitoring, snapshots, drift, incidents, alerting, tenants and so on), with the same concept names used across the layers so the context for one concept lives in one place per layer. The application ports are split by role (repositories, unit of work, gateways, system) and the infrastructure system adapters by concern (messaging, secrets, logging, system).

Files only moved and their import paths changed; no behaviour changed. The names exported by each package entry point are unchanged.

## f1a984d: fix(infra): run the demo server as a single instance

The demo server keeps its tool description in memory. With up to 5 instances, a probe could reach an instance that still had the old text and report a false revert, or flap between drift and revert during a live demo. The demo server now runs at most one instance; api and worker keep 5.

## 974997d: fix(infra): give the deploy's temporary stack config a yaml name

Pulumi infers a config file's format from its extension, and `scripts/deploy.sh` copied the stack config to an extensionless `mktemp` file, so the first deploy stopped with "no marshaler found". The copy now keeps the name `Pulumi.dev.yaml` inside a temp directory. Also records the `dev` stack's encryptionsalt, which CI needs to open the stack.

## a4177b9: chore(infra): record the applied bootstrap stack config

Commits the bootstrap stack's settings after its first apply: the numeric GitHub repository id the CI trust is pinned to, the state bucket name, and the stack's encryptionsalt. No secret values: every secret lives in Secret Manager.

## c36e2ed: chore: ignore compiled infra output and local test reports

ESLint now skips `bin/`, where the Pulumi programs compile, so a local infra build no longer breaks `npm run lint`. Git ignores `.vitest/`, a report directory some local test wrappers write.

## d356e06: docs(plan): drop process wording and rename the health route

Removes maintainer-process wording from the plan now that the repository is public, and updates the plan's health route to `/health`.

## f75e77e: fix: close final-review gaps before first deploy

Pulumi now runs ahead-of-time compiled programs (`infra/bin`, built with `typescript` 6.0.3), because its bundled ts-node rejected the shared tsconfig, and the migrate and create-tenant jobs carry their script in `commands` so `--args=--name=x` reaches it. A failed webhook delivery now keeps its reason (`outbox.last_error`, migration 0002) and the worker logs one `webhook.delivery_failed` event per failure; `/healthz` became `/health` because Cloud Run reserves paths ending in `z`.

The deployer lost `roles/logging.configWriter` (it could create sinks that silence the probe-failure alert) for a custom role with the five log-metric permissions, and `roles/browser` as redundant. The pool's error log is now the Cloud Logging shape, the worker's startup and shutdown match the api's, and the README and deploy script say what a first deploy needs.

## 1d38f5a: feat(dashboard): add monitors, drift and incidents views

Adds `apps/dashboard`, a Vue 3 and Vite single-page app over the `/v1` API: the monitor list, a monitor page with probe history, the current drift as a diff that marks critical and breaking changes, and an approve button, and the open incidents with an acknowledge button. Its API types are generated from `openapi.yaml` by `npm run api:types`, committed, and checked in CI. Probed-server text is only ever interpolated as text, and the API key lives in `sessionStorage` and travels only in the `Authorization` header.

The api serves the build at `/` with `@fastify/static` from `DASHBOARD_DIR` (default `apps/dashboard/dist`) when it exists, falling back to `index.html` for browser navigations outside the API paths, which keep their problem+json 404s. The Dockerfile builds the dashboard and copies it into the api image only.

## 995712e: feat(api): expose read-only Keelson MCP tools

Adds `POST /mcp` to the api so an agent can ask which of its servers drifted. Three read-only tools, `list_monitors`, `get_drift` and `list_open_incidents`, call the existing queries and presenters, so they return what the REST API returns and never a secret reference. The route reuses the API-key security handler as an `onRequest` hook, so a missing or wrong key gets 401 before any MCP handling, and each request builds its own stateless server bound to the caller's tenant. A monitor that is missing or belongs to another tenant yields the same `isError` result. `get_drift` keeps probed-server text verbatim but adds an `untrustedContent` warning to its result and description, since that text is where a rug pull hides its instructions.

The per-request server and transport wiring and the Fastify to web request conversion move into a new `@keelson/mcp-http` package that both the api and the demo server use, guarded by a `mcp-http-only-from-apps` dependency rule. `GET` and `DELETE` on the MCP path now answer 405 with `Allow: POST`.

## eef31b9: test(e2e): prove the rug-pull path end to end and document local runs

Adds the `@keelson/e2e` workspace, which starts Postgres with Testcontainers and runs the api, worker and demo server in one process on ephemeral ports with one controllable clock, then proves the headline path: a tool description rewritten on the demo server yields exactly one critical `drift` incident and one delivery whose Standard Webhooks signature verifies, and a repeated dispatch and drain delivers nothing more. The api and worker now export their builders from `package.json` so the test can use them. `HttpProbeQueue` now accepts a job and returns, as Cloud Tasks does, and reports a failed delivery to an `onDeliveryError` callback: it used to wait for the worker's probe, which locks the monitor row the dispatch still holds, so every local dispatch deadlocked until its timeout. The e2e polls the API for each probe. Also adds `docker-compose.yml` with a curl scheduler, `npm run seed` to register the five public servers without duplicates, and the README.

## b92e2c4: build(infra): deploy Keelson to Cloud Run with Pulumi

Adds one multi-stage Dockerfile that builds the api, worker and demo-server images, and two Pulumi programs under `infra/` (outside the root workspaces, with their own lockfile, so Pulumi's OpenTelemetry versions never reach the apps). The main stack runs the services on Cloud Run with Cloud Tasks, Cloud Scheduler and a retries-exhausted alert; a separate bootstrap stack, applied once by a person, owns the service accounts, secrets, custom roles, the GitHub trust and every project-level binding, so the CI deployer holds no right to edit project IAM and cannot widen its own access. The api's and worker's secret access is limited by IAM conditions to monitor and webhook secrets. The deploy workflow runs only after CI passes on `main`, pull request previews run as a read-only account, and Pulumi mock tests pin the wiring against the apps' own config schemas.

## 18df2dd: docs(plan): list the api and secret store environment variables

Adds `API_URL` (the api's own URL, default audience for `/internal/dispatch`), `SECRET_STORE` and `SECRETS_DIR` to the plan's environment variables, so the Pulumi task deploys with the names the services read.

## 4c423b0: feat(api): serve the OpenAPI-first v1 API, dispatch and admin commands

Adds `apps/api`, the public Cloud Run service. `openapi.yaml` (3.1) is the source of truth: fastify-openapi-glue binds the routes, validates requests strictly (unknown fields are refused, not passed on) and serializes only the fields of each response schema, so secret references cannot leak. It also adds API-key auth, problem+json errors, the Scalar reference at `/reference`, `POST /internal/dispatch` for Cloud Scheduler, and the `migrate` and `create-tenant` commands. The environment parsing and adapter factories the api shares with the worker moved to `@keelson/infrastructure`, and the domain gained `parseSnapshotHash` so a hash from a request is validated, never cast.

## 988ab96: feat(worker): serve probe, inspect and outbox drain endpoints

Adds `apps/worker`, the Cloud Run service that Cloud Tasks and the api call: `POST /internal/probe` answers 204 or 500 so a failed probe is retried (the last retry logs `probe.retries_exhausted`), `/internal/inspect` returns an inspection without writing, and `/internal/outbox/drain` delivers due alerts. It is the first composition root, wiring adapters with awilix from a zod-parsed environment that fails fast with every problem listed. A dependency rule keeps awilix out of `packages/`, and `FileSecretStore` lets local runs share secrets between api and worker without Secret Manager.

## dcce76f: feat(infrastructure): add Cloud Tasks, Secret Manager and internal auth adapters

Adds the remaining infrastructure adapters: the Cloud Tasks probe queue, which names each task `probe-<monitorId>-<slot>` so a repeated fan-out is rejected by the queue itself (ALREADY_EXISTS counts as success), the Secret Manager store, and the system clock, UUID ids and random credential factory. Calls between `api` and `worker` are authenticated by a Google OIDC verifier and caller, with a static-token pair for local and e2e runs; the verifier answers `false` for any bad token and never throws. The `api` side reaches the worker through `WorkerInspectorClient` and the local `HttpProbeQueue`, which use plain `fetch` because the worker URL is Keelson's own, so both ship from the main entry and stay clear of the egress code.

## ecc6e52: feat(infrastructure): add SSRF-guarded MCP inspector, webhook channels and demo server

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
