# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Keelson dashboard into a dark, Scalar-styled monitoring console with pagination, filtering, search and every API action, backed by read-only API additions.

**Architecture:** Health is a domain rule (`healthStateOf`). The application gains read-model ports (`MonitorDirectory`, `IncidentDirectory`) whose Postgres adapters compute summaries, filters and totals in SQL; queries compose them. The API exposes them OpenAPI-first; the dashboard regenerates its types and rebuilds its views on one shared list foundation (URL-synced filters, cursor stack, refresh timer).

**Tech Stack:** TypeScript 6, Vitest 5, Fastify 5 + fastify-openapi-glue, `pg`, Vue 3.5 + vue-router 5 + Vite 8, @vue/test-utils + happy-dom, openapi-typescript.

**Spec:** `docs/superpowers/specs/2026-10-25-dashboard-redesign-design.md` (read the "Calls made after the builder check" section: it settles details this plan relies on).

## Global Constraints

- No new runtime dependencies anywhere; no new dev dependencies unless a test cannot be written without one.
- Onion layering and every dependency-cruiser rule stay green: health rule in `packages/domain`, read ports and queries in `packages/application`, SQL in `packages/infrastructure/src/postgres`, HTTP in `apps/api`, awilix only in `apps/*`. Constructors take one deps object.
- New package code goes in the concept folders that exist (`monitoring/`, `incidents/`, `queries/`, `ports/`, `postgres/`), not in new top-level grab-bags.
- OpenAPI-first: every new parameter and field is in `apps/api/openapi.yaml` first; `npm run api:types` regenerates `apps/dashboard/src/api/schema.d.ts`, which is committed. No hand-written response types in the dashboard.
- Existing operations stay backward compatible: new query parameters optional, new response fields additive.
- Scalar dark theme tokens exactly as the spec's table; fonts not bundled.
- Untrusted text (anything a probed server returned: tool names, descriptions, URIs, error details, server names and versions) is rendered only with Vue text interpolation; never `v-html`, `innerHTML`, or a bound `href`/`src`.
- The API key stays in `sessionStorage`, never in a URL, query string, log or `localStorage`.
- Zero added cost; no infra changes.
- No em dashes; no personal data. Each task adds its `COMMITS.md` entry (`## pending: <message>`, two or three lines) at the top under the intro. Daniel commits; implementers never run git state-changing commands.
- Run only the task's test files plus `npm run typecheck`, `npm run lint`, `npm run deps:check` (Postgres tests need Docker, which is running).

## Review Focus

1. The SQL health filter and the domain `healthStateOf` disagree on an edge case (paused with an open incident, no probe yet with an incident): a parity test runs the same case table through both (Task 1 defines the table, Task 3 asserts Postgres against it).
2. Changing a filter, search or page size while on page 3 must reset to page 1 and drop the cursor stack; a stale cursor under a new filter shows wrong rows (test in Task 5).
3. The 60 s refresh timer must stop on unmount and while the tab is hidden; a leaked timer keeps polling after navigation (test in Task 5).
4. Deleting, approving or pausing the last row of the last page must step back a page instead of showing an empty page (test in Task 6).
5. Search text containing `%`, `_` or `\` must match literally, and `q` over 100 characters is a 400 (tests in Tasks 3 and 4).

---

### Task 1: Domain health rule

**Files:**
- Create: `packages/domain/src/monitoring/health-state.ts`, `packages/domain/src/monitoring/health-state.test.ts`, `packages/domain/src/monitoring/health-state-cases.ts` (the shared case table, exported for Task 3's parity test)
- Modify: `packages/domain/src/index.ts` (export)

**Interfaces:**
- Produces: `type HealthState = 'up' | 'drift' | 'down' | 'paused' | 'pending'`; `HEALTH_STATES: readonly HealthState[]`; `interface HealthStateInputs { status: MonitorStatus; hasProbe: boolean; openIncidentKinds: readonly IncidentKind[] }`; `healthStateOf(inputs: HealthStateInputs): HealthState`; `HEALTH_STATE_CASES: readonly { name: string; inputs: HealthStateInputs; expected: HealthState }[]`.

- [ ] **Step 1: Write the failing test.** `it.each(HEALTH_STATE_CASES)` asserts `healthStateOf(inputs) === expected`. The table must contain at least: paused with an open down incident -> `paused`; active, down and drift both open -> `down`; drift only -> `drift`; no probe and no incident -> `pending`; no probe but an open drift incident -> `drift`; probed, no incident -> `up`; paused and never probed -> `paused`.
- [ ] **Step 2: Run to verify it fails.** `npx vitest run packages/domain/src/monitoring/health-state.test.ts`
- [ ] **Step 3: Implement** first-match-wins in the spec's order (paused, down, drift, pending, up).
- [ ] **Step 4: Run to verify it passes.** Same command.
- [ ] **Step 5: Commit command.** `git add packages/domain COMMITS.md` / `git commit -m "feat(domain): derive a monitor's health from status, probes and open incidents"`

---

### Task 2: Application read models and queries

**Files:**
- Create: `packages/application/src/ports/directories.ts` (re-exported from `ports/index.ts`), `packages/application/src/queries/dashboard-queries.ts`, `packages/application/src/queries/dashboard-queries.test.ts`, `packages/application/src/testing/in-memory-directories.ts` (exported from `testing/index.ts`)
- Modify: `packages/application/src/ports/repositories.ts` (add `CountedPage`; `ProbeRepository.listForMonitor` and `WebhookEndpointRepository.listForTenant` return `CountedPage`), `packages/application/src/ports/unit-of-work.ts` (`Transaction` gains `monitorDirectory` and `incidentDirectory`), `packages/application/src/testing/in-memory-repositories.ts`, `packages/application/src/testing/in-memory-unit-of-work.ts`, `packages/application/src/queries/queries.ts` (existing `listProbes`/`listWebhookEndpoints` return `CountedPage`), `packages/application/src/index.ts`

**Interfaces:**
- Consumes: `healthStateOf`, `HealthState`, `HEALTH_STATES` (Task 1); existing `Monitor`, `Probe`, `Incident`, `Severity`, `IncidentKind`, `PageRequest`, `Page`.
- Produces (`ports/directories.ts`):
  - `interface CountedPage<T> extends Page<T> { total: number }`
  - `interface LatestProbe { outcome: ProbeOutcome; startedAt: Date; latencyMs: number }`
  - `interface MonitorSummary { monitor: Monitor; health: HealthState; latestProbe: LatestProbe | null; recentLatenciesMs: (number | null)[]; toolCount: number | null; openIncident: { id: string; kind: IncidentKind; severity: Severity | null } | null }`
  - `interface MonitorFilter { health: HealthState | null; search: string | null }`
  - `type HealthCounts = Record<HealthState, number> & { total: number }`
  - `interface ProbeStats { windowHours: number; probes: number; uptimeRatio: number | null; p95LatencyMs: number | null }`
  - `interface MonitorDirectory { listSummaries(tenantId: string, filter: MonitorFilter, page: PageRequest): Promise<CountedPage<MonitorSummary>>; summaryOf(tenantId: string, monitorId: string): Promise<MonitorSummary | null>; healthCounts(tenantId: string): Promise<HealthCounts>; probeStats(monitorId: string, since: Date): Promise<ProbeStats> }`
  - `interface IncidentView { incident: Incident; monitorName: string; severity: Severity | null }`
  - `interface IncidentFilter { state: 'open' | 'resolved' | null; kind: IncidentKind | null; acknowledged: boolean | null }`
  - `interface IncidentCounts { open: number; acknowledged: number; resolved: number; drift: number; down: number }` (open excludes acknowledged; drift and down count open incidents of that kind)
  - `interface IncidentDirectory { list(tenantId: string, filter: IncidentFilter, page: PageRequest): Promise<CountedPage<IncidentView>>; counts(tenantId: string): Promise<IncidentCounts> }`
- Produces (`queries/dashboard-queries.ts`), each `(tx: Transaction, input) => Promise<...>`, tenant-scoped, `NotFoundError` for another tenant's monitor: `listMonitorSummaries({ tenantId, filter, page })`, `getMonitorSummary({ tenantId, monitorId })`, `getHealthCounts({ tenantId })`, `getMonitorStats({ tenantId, monitorId, now })` (24 h window: `STATS_WINDOW_HOURS = 24`), `listIncidentViews({ tenantId, filter, page })`, `getIncidentCounts({ tenantId })`.
- Constants: `RECENT_LATENCY_PROBES = 24`, `SEARCH_MAX_LENGTH = 100`.

- [ ] **Step 1: Write the failing tests** (in-memory directories, fixed clock):
  - `listMonitorSummaries filters by health and search, case-insensitively, and returns the total of the filtered set`
  - `a summary carries the latest probe, up to 24 recent latencies oldest first with null for failed probes, the baseline tool count, and the open incident with its severity`
  - `health counts are exclusive and sum to total`
  - `monitor stats count only probes in the last 24 h; p95 uses up probes only; both null without probes`
  - `incident views carry the monitor name and drift severity; filters combine state, kind and acknowledged; counts exclude acknowledged from open`
  - `another tenant's monitor is NotFoundError for summary and stats`
  - `listProbes and listWebhookEndpoints now include total`
  - The in-memory `MonitorDirectory` computes health with `healthStateOf` and passes every row of `HEALTH_STATE_CASES`.
- [ ] **Step 2: Run to verify they fail.** `npx vitest run packages/application/src/queries packages/application/src/testing`
- [ ] **Step 3: Implement** the ports, the in-memory directories over the existing in-memory maps, and the queries. Queries hold no rules beyond composing ports and `healthStateOf`.
- [ ] **Step 4: Run to verify they pass.** `npx vitest run packages/application/src`
- [ ] **Step 5: Commit command.** `git add packages/application COMMITS.md` / `git commit -m "feat(application): add monitor and incident read models for the dashboard"`

---

### Task 3: Postgres directories

**Files:**
- Create: `packages/infrastructure/src/postgres/monitor-directory.ts`, `packages/infrastructure/src/postgres/incident-directory.ts`, `packages/infrastructure/src/postgres/directories.test.ts`; `packages/infrastructure/migrations/0003_dashboard_reads.sql` only if a query needs an index that does not exist (why-header, idempotent, Up and Down)
- Modify: `packages/infrastructure/src/postgres/unit-of-work.ts` (wire both directories into the transaction), `probe-repository.ts` and `webhook-endpoint-repository.ts` (totals), `packages/infrastructure/src/index.ts`

**Interfaces:**
- Consumes: Task 2 ports; `HEALTH_STATE_CASES` (Task 1).
- Produces: `class PostgresMonitorDirectory implements MonitorDirectory { constructor(deps: { client: Queryable }) }`, `class PostgresIncidentDirectory implements IncidentDirectory { constructor(deps: { client: Queryable }) }` (use the same `Queryable` type and construction pattern the repositories in `unit-of-work.ts` use).

- [ ] **Step 1: Write the failing tests** against Testcontainers Postgres, mirroring Task 2's list plus:
  - `parity: for every HEALTH_STATE_CASES row, the SQL health of a seeded monitor equals the case's expected value, and the health filter returns it`
  - `search matches name or url case-insensitively and treats %, _ and \ literally`
  - `recent latencies come from the newest 24 probes, ordered oldest first`
  - `tool count reads the baseline snapshot's tools array length`
  - `pagination with a filter keeps the filter across pages and the total stays the filtered count`
  - `tenant isolation for every method`
- [ ] **Step 2: Run to verify they fail.** `npx vitest run packages/infrastructure/src/postgres`
- [ ] **Step 3: Implement.** Health in SQL as one `CASE` expression in a CTE (paused, open down, open drift, no probe, else up) so filtering and counting use the same expression. Latest probe and recent latencies through `LATERAL` subqueries on `probes (monitor_id, started_at desc)`. Escape `%`, `_` and `\` in search with `ESCAPE '\'`. Totals with `count(*)` over the same filtered CTE. Row mappers stay the only place that knows column names.
- [ ] **Step 4: Run to verify they pass.** Same command.
- [ ] **Step 5: Commit command.** `git add packages/infrastructure COMMITS.md` / `git commit -m "feat(infrastructure): compute monitor and incident read models in Postgres"`

---

### Task 4: API contract and handlers

**Files:**
- Modify: `apps/api/openapi.yaml`, `apps/api/src/handlers.ts`, `apps/api/src/presenters.ts`, `apps/api/src/server.test.ts`, `apps/dashboard/src/api/schema.d.ts` (regenerated with `npm run api:types`, never edited by hand)

**Interfaces:**
- Consumes: Task 2 queries.
- Produces (OpenAPI, exactly as the spec's "API additions" plus Call 1): `listMonitors` gains `health`, `q` (`maxLength: 100`) and responds `{ items: MonitorWithSummary[], nextCursor, total }`; `getMonitor` responds `MonitorWithSummary`; new `getHealthCounts` (`GET /v1/monitors/health-counts`, declared before `/v1/monitors/{monitorId}` so routing cannot shadow it), `getMonitorStats` (`GET /v1/monitors/{monitorId}/stats`), `getIncidentCounts` (`GET /v1/incidents/counts`); `listIncidents` gains `kind` and `acknowledged`, items become `IncidentView` (incident fields plus `monitorName`, `severity`), response adds `total`; `listProbes` and `listWebhookEndpoints` add `total`. `MonitorWithSummary` = the existing `Monitor` fields plus `summary: { health, latestProbe, recentLatenciesMs, toolCount, openIncident }`. Dates are ISO strings as elsewhere.

- [ ] **Step 1: Write the failing tests** (in-memory container, existing test support):
  - one test per new parameter and field above, including `total`
  - `health=bogus`, `kind=bogus` and a 101-character `q` are 400 problem+json
  - `GET /v1/monitors/health-counts` is not captured by `/v1/monitors/{monitorId}`
  - `another tenant's monitor stats and summary are 404`
  - `existing clients still work: listMonitors without new parameters returns every monitor with its summary`
- [ ] **Step 2: Run to verify they fail.** `npx vitest run apps/api`
- [ ] **Step 3: Implement** the contract, then handlers and presenters (handlers pick query fields explicitly, no business rules). Run `npm run api:types`.
- [ ] **Step 4: Run to verify they pass.** `npx vitest run apps/api` and `npm run api:types && git diff --stat -- apps/dashboard/src/api/schema.d.ts` (the regenerated file is part of the change).
- [ ] **Step 5: Commit command.** `git add apps/api apps/dashboard/src/api/schema.d.ts COMMITS.md` / `git commit -m "feat(api): expose dashboard read models: health, summaries, stats, counts and totals"`

---

### Task 5: Dashboard foundation: theme, shell and shared list behaviour

**Files:**
- Modify: `apps/dashboard/src/style.css` (replace with the Scalar tokens as CSS variables and base styles), `App.vue` (shell: sidebar, page header slot), `apps/dashboard/src/api/client.ts` (methods for every operation the pages use, returning the generated types; paged methods return the page with `total` instead of collecting all pages), `router.ts` (routes `/` Overview, `/monitors`, `/monitors/:id`, `/incidents`, `/webhooks`, fallback to `/`)
- Create: `apps/dashboard/src/components/AppSidebar.vue`, `StatusPill.vue`, `LatencySparkline.vue` (inline SVG), `DataList.vue` (table frame + loading skeleton + empty + error with Retry), `ListPagination.vue`, `ConfirmDialog.vue`, `ToastHost.vue`; `apps/dashboard/src/composables/useListQuery.ts`, `useToasts.ts`, `useRelativeTime.ts`; tests beside each
- Remove: whatever existing component or composable the new ones replace (`useLoadedData.ts` if unused after the change); keep `DriftDiff.vue` and `ApiKeyGate.vue`, restyled

**Interfaces:**
- Produces:
  - `useListQuery<Filters extends Record<string, string | null>>(options: { defaults: Filters; pageSizes: readonly number[]; load: (args: { filters: Filters; cursor: string | null; limit: number }) => Promise<{ items: unknown[]; nextCursor: string | null; total: number }>; refreshMs?: number })` returning reactive `{ items, total, page, pageSize, filters, loading, error, rangeLabel, hasNext, hasPrevious, next(), previous(), setFilter(name, value), setPageSize(n), refresh() }`. It syncs `filters`, `page`, `limit` and `cursor` to the route query, keeps a cursor stack for Previous, resets to page 1 on any filter or size change, refreshes every `refreshMs` (default 60 000) only while `document.visibilityState === 'visible'`, and stops on unmount. `rangeLabel` reads "Showing a-b of total" (a = (page - 1) x size + 1).
  - `StatusPill` props `{ health: HealthState | 'resolved'; severity?: 'critical' | 'warning' | null; label?: string }` (dot + text, colours per the spec).
  - `LatencySparkline` props `{ values: (number | null)[] }` (null drawn as a red full-height bar).
  - `useToasts()` `{ success(text), failure(error) }`; `ConfirmDialog` props `{ title, body, confirmLabel, danger? }`, emits `confirm`, `cancel`.
- Page sizes `[10, 20, 50]`, default 20; search debounce `SEARCH_DEBOUNCE_MS = 300`.

- [ ] **Step 1: Write the failing tests:**
  - `useListQuery`: next and previous walk the cursor stack; a filter change on page 3 resets to page 1 and clears the stack (Review Focus 2); the query string carries filters, page, limit and cursor but never the API key; the refresh timer fires only while visible and stops after unmount (Review Focus 3); `rangeLabel` is right on the first, middle and last page.
  - `StatusPill` renders dot plus text for every health; `LatencySparkline` renders one bar per value and marks nulls.
  - `AppSidebar` shows the counts it is given, opens the API reference link in a new tab with `rel="noopener"`, shows the key masked to its last 4 characters, and "Sign out" clears it from `sessionStorage`.
  - `useRelativeTime` renders "2 min ago" with the absolute UTC time as the element's `title`.
  - `client.ts` sends `health`, `q`, `kind`, `acknowledged`, `cursor`, `limit` and returns `total`.
- [ ] **Step 2: Run to verify they fail.** `npx vitest run apps/dashboard`
- [ ] **Step 3: Implement.** The old pages may stay temporarily wired to the new client so the app still builds; Tasks 6 to 8 replace them.
- [ ] **Step 4: Run to verify they pass.** `npx vitest run apps/dashboard`, then `npm run build -w apps/dashboard` once to prove the bundle builds.
- [ ] **Step 5: Commit command.** `git add apps/dashboard COMMITS.md` / `git commit -m "feat(dashboard): add the Scalar-themed shell and shared list behaviour"`

---

### Task 6: Monitors page and add-monitor dialog

**Files:**
- Modify: `apps/dashboard/src/pages/MonitorsPage.vue`, `MonitorsPage.test.ts`
- Create: `apps/dashboard/src/components/AddMonitorDialog.vue`, `ApproveBaselineDialog.vue`, `MonitorRowMenu.vue`, tests beside each

**Interfaces:**
- Consumes: Task 5 foundation and client.
- Produces: the Monitors page as in the approved mockup: search, health segmented control with counts from `getHealthCounts` (Pending shown only when non-zero), table (dot + pill, name, URL mono, sparkline + latest latency, tool count, relative last probe), row menu (Review drift and Approve new baseline only when drifted, Probe history, Pause or Resume, Delete with `ConfirmDialog` naming the monitor), "Add monitor" dialog (name, URL, interval select 5/15/30/60 min default 15 sent as seconds with the demo-mode hint, optional bearer token), pagination.
- `ApproveBaselineDialog` fetches `GET /v1/monitors/{id}/drift`, shows change count, highest severity and `toHash`, approves that hash (spec Call 4).

- [ ] **Step 1: Write the failing tests:**
  - filters and search call the client with `health` and `q` and update the URL
  - Add monitor: success closes and refreshes; a 400 shows every problem from `errors`; the interval goes out in seconds
  - Approve: fetches drift first, shows the hash, sends exactly that `snapshotHash`
  - Pause/Resume sends `status`; Delete asks first and sends DELETE only after confirm
  - acting on the last row of the last page steps back a page (Review Focus 4)
  - a monitor named `<img src=x onerror=alert(1)>` renders as literal text
- [ ] **Step 2: Run to verify they fail.** `npx vitest run apps/dashboard/src/pages/MonitorsPage.test.ts apps/dashboard/src/components`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass.** Same command.
- [ ] **Step 5: Commit command.** `git add apps/dashboard COMMITS.md` / `git commit -m "feat(dashboard): add the monitors console with filters, actions and pagination"`

---

### Task 7: Monitor detail page

**Files:**
- Modify: `apps/dashboard/src/pages/MonitorPage.vue`, `MonitorPage.test.ts`, `apps/dashboard/src/components/DriftDiff.vue` (restyle as change cards; keep its escaping tests)
- Create: `apps/dashboard/src/components/MonitorSettingsForm.vue`, `ProbeHistoryTable.vue`, `SnapshotView.vue`, tests beside each

**Interfaces:**
- Consumes: `getMonitor` (with summary), `getMonitorStats`, `getDrift`, `listProbes` (paged), `getSnapshot` (baseline hash), `updateMonitor`, `deleteMonitor`, `approveBaseline`; `ApproveBaselineDialog` (Task 6).
- Produces: header (breadcrumb, name, pill, Pause/Resume, Approve enabled only when drifted), stat cards (uptime 24 h as a percentage with one decimal, p95 ms, interval in minutes, baseline hash shortened to 8 characters, mono; "n/a" for nulls), tabs Drift / Probe history / Snapshot / Settings with the tab in the query string, the untrusted-content banner above any probed text.

- [ ] **Step 1: Write the failing tests:** stats render nulls as "n/a"; Drift shows the banner and the empty state when no drift; Probe history pages with `total`; Snapshot lists the baseline's tools with descriptions as text; Settings sends name, interval (seconds) and token changes, clearing the token sends `authSecret: null`; Delete navigates back to `/monitors`; a tool description with `<script>` stays literal on Drift and Snapshot.
- [ ] **Step 2: Run to verify they fail.** `npx vitest run apps/dashboard/src/pages/MonitorPage.test.ts apps/dashboard/src/components`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass.** Same command.
- [ ] **Step 5: Commit command.** `git add apps/dashboard COMMITS.md` / `git commit -m "feat(dashboard): add the monitor detail page with stats, drift, history, snapshot and settings"`

---

### Task 8: Incidents, Webhooks and Overview pages

**Files:**
- Modify: `apps/dashboard/src/pages/IncidentsPage.vue`, `IncidentsPage.test.ts`
- Create: `apps/dashboard/src/pages/WebhooksPage.vue`, `WebhooksPage.test.ts`, `apps/dashboard/src/pages/OverviewPage.vue`, `OverviewPage.test.ts`, `apps/dashboard/src/components/AddWebhookDialog.vue` (+ test)
- Modify: `README.md` (one short "Dashboard" paragraph: pages and where the key is kept), `apps/api/src/dashboard-static.test.ts` only if a new route needs the SPA fallback asserted (`/webhooks`, `/monitors`)

**Interfaces:**
- Consumes: `listIncidentViews` via client, `getIncidentCounts`, `acknowledgeIncident`, webhook endpoint operations, `getHealthCounts`, `listMonitors` with `health`.
- Produces: Incidents (state filter Open/Acknowledged/Resolved mapped per spec Call 2, kind filter, counts, monitor link, kind + severity pill, opened, state or resolution pill, duration for resolved, Acknowledge on open unacknowledged rows, pagination); Webhooks (list with format pill, URL masked after the host, status, failures; Add shows the signing secret once in a copyable box with the warning; Disable/Enable; Delete with confirm); Overview (four counters, open incidents up to 5 with acknowledged ones marked, down and drift monitors via two filtered calls of 10, per spec Call 3); sidebar counts from `getHealthCounts` and `getIncidentCounts` (badge = open unacknowledged).

- [ ] **Step 1: Write the failing tests:** the three incident tabs send the mapped parameters; Acknowledge calls the endpoint and refreshes; a resolved incident shows its resolution and duration; the webhook secret appears once and is gone after closing; a Slack URL shows only scheme and host; Disable sends `status: 'disabled'`; Overview renders counters and both lists from the mocked client; the SPA serves `/webhooks` and `/monitors`.
- [ ] **Step 2: Run to verify they fail.** `npx vitest run apps/dashboard apps/api/src/dashboard-static.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass.** Same command, then `npm run build -w apps/dashboard`.
- [ ] **Step 5: Commit command.** `git add apps/dashboard apps/api/src/dashboard-static.test.ts README.md COMMITS.md` / `git commit -m "feat(dashboard): add incidents, webhooks and overview pages"`
