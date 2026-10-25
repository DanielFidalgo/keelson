# Keelson dashboard redesign: design

Date: 2026-10-25
Status: approved in conversation (mockups approved), pending written review

## Intent

The dashboard (`apps/dashboard`, Vue 3 + Vite, served by `apps/api` at `/`) works but looks like a demo page: three bare views, no filtering, no pagination controls, few actions. It will be on screen in a live walkthrough, next to the Scalar API Reference that Keelson already serves at `/reference`. It must look like a professional monitoring product and feel at home beside Scalar's own UI.

Success: someone who has never seen Keelson can tell within seconds which servers are up, drifted or down, open one, read the drift, approve or pause it, and page and filter through 19+ monitors and their incidents, all without leaving the dashboard or seeing anything that looks unfinished.

## Goals

- A dark console in Scalar's own visual identity (the approved mockups).
- Pagination, filtering and search on every list.
- Every action the API offers is reachable from the UI.
- Read-only API additions that make the above efficient, OpenAPI-first.

## Non-goals

- Light mode, theming options, mobile-first layout (desktop at 1280 px and up is the target; it must not break at 1024 px).
- Real-time push. Lists refresh on demand and on a timer (see Behaviour).
- New infrastructure, accounts, roles or SSO. The API key gate stays as it is.
- A charts library. Sparklines are small inline SVG.

## Anti-goals (failure even if it works)

- Any text that comes from a probed server rendered as HTML, used in an `href`, or interpreted. Vue text interpolation only, as today.
- The API key in a URL, a log, or `localStorage` (it stays in `sessionStorage`).
- Hand-written response types that drift from `openapi.yaml`. Types stay generated (`npm run api:types`) and CI keeps checking them.
- Anything that adds cost: no new GCP resources, no new paid services.

## Visual identity

Taken from the Scalar API Reference dark theme bundled in `@scalar/fastify-api-reference` (`.dark-mode` variables):

| Token | Value |
|---|---|
| background 1 / 2 / 3 | `#0f0f0f` / `#1a1a1a` / `#272727` |
| text 1 / 2 / 3 | `#e7e7e7` / `#a4a4a4` / `#797979` |
| accent | `#00aeff` |
| border | `#2d2d2d` |
| green / red / yellow / orange | `#00b648` / `#dc1b19` (text on dark: `#ff5a57`) / `#ffc90d` / `#ff8d4d` |
| primary button | white background, black text |
| font | `Inter, ui-sans-serif, system-ui, sans-serif`; code and hashes `"JetBrains Mono", ui-monospace, Menlo, monospace` |

Status colours: up = green, drift = orange (critical) or yellow (warning only), down = red, paused and pending = text 2 on background 3. Status always shows as a dot plus a text pill, never colour alone.

Fonts are not bundled (no new dependency); the stacks fall back to the system UI font.

## Pages (as in the approved mockups)

Layout: fixed left sidebar (brand, Overview, Monitors with count, Incidents with open count in orange, Webhooks with count, "API reference" link to `/reference/` in a new tab, tenant footer with the masked key and "Sign out" which clears the key), main area with a page header (title, search where relevant, primary action).

1. **Overview** (`/`): four counters (monitors, up, drifted, down), the open incidents (at most 5, link to Incidents), and the monitors whose latest probe failed or drifted.
2. **Monitors** (`/monitors`): search by name or URL; health filter as a segmented control with counts (All, Up, Drift, Down, Paused; Pending appears only when non-zero); table with status dot and pill, name and URL (mono), latency sparkline of the last 24 probes plus the latest value, tool count, last probe ("2 min ago"); row menu: Review drift (only when drifted), Approve new baseline (only when drifted), Probe history, Pause or Resume, Delete (confirmation dialog naming the monitor). "Add monitor" opens a dialog (name, URL, interval in minutes with minimum 5, optional bearer token) that shows the API's 400 problems inline and closes on success.
3. **Monitor detail** (`/monitors/:id`): breadcrumb, name, status pill, Pause/Resume, Approve new baseline (enabled only when drifted); stat cards (uptime over the last 24 h, p95 latency over the last 24 h, interval, baseline hash shortened, mono); tabs:
   - Drift: the untrusted-content banner, then each change as a card (severity pill, kind, target in mono, before/after diff for descriptions, classification for schema changes); empty state "Matches the approved baseline".
   - Probe history: paginated table (time, outcome pill, latency, server version, error detail truncated with the full text on hover).
   - Snapshot: the baseline's tools (name, description as text), prompts and resources.
   - Settings: rename, interval, replace or clear the bearer token, delete.
4. **Incidents** (`/incidents`): state filter (Open, Acknowledged, Resolved) and kind filter (All, Drift, Down), each with counts; table with monitor (link), kind and severity pill, opened, state or resolution pill (Recovered, Approved, Reverted), duration for resolved ones, Acknowledge on open unacknowledged rows.
5. **Webhooks** (`/webhooks`): list (format pill, URL in mono with the path masked after the host, status, consecutive failures); Add (URL, format) shows the signing secret once in a copyable box with a "you will not see this again" note; Disable/Enable; Delete with confirmation.

Shared: every list has pagination (page size 10, 20 or 50; "Showing a-b of total"; Previous and Next), a loading skeleton, an empty state, and an error state with Retry. Actions show a short toast on success and the problem's text on failure. Times show relative ("2 min ago") with the absolute UTC time on hover.

## Behaviour

- Health of a monitor, first match wins: `paused` (status paused), `down` (an open `down` incident), `drift` (an open `drift` incident), `pending` (no probe yet), otherwise `up`. A latest probe that failed without a `down` incident yet (fewer than 3 consecutive failures) still reads `up`; the failure shows in the sparkline and the last-probe cell. This rule lives in the domain (`healthStateOf`) and is the only place that knows it; the SQL health filter must produce the same result and a test pins both against the same cases.
- Lists refresh when the page opens, when filters change, after any action, on a Refresh button, and every 60 s while the tab is visible. The timer stops when the tab is hidden.
- Filters, search, page size and the current page's cursor live in the URL query string (never the API key), so the browser back button and a pasted link restore the view.
- Pagination stays cursor-based on the API. The dashboard keeps a stack of the cursors it has seen to offer Previous.
- Search is debounced (300 ms) and case-insensitive on name and URL.

## API additions (read-only, OpenAPI-first)

Existing operations stay backward compatible; new parameters are optional.

- `GET /v1/monitors`: new query `health` (`up` | `drift` | `down` | `paused` | `pending`) and `q` (substring, case-insensitive, max 100 chars); response adds `total` (count matching the filters) and, per item, a `summary`: `health`, `latestProbe` (`{ outcome, startedAt, latencyMs }` or null), `recentLatenciesMs` (the last up to 24 probes, oldest first, `null` for a failed probe), `toolCount` (from the baseline snapshot, null without one), `openIncident` (`{ id, kind, severity }` or null).
- `GET /v1/monitors/health-counts`: `{ total, up, drift, down, paused, pending }` for the tenant.
- `GET /v1/monitors/{monitorId}/stats`: `{ windowHours: 24, probes, uptimeRatio, p95LatencyMs }` (`uptimeRatio` null when there were no probes; `p95LatencyMs` over up probes only, null if none).
- `GET /v1/monitors/{monitorId}/probes`: response adds `total`.
- `GET /v1/incidents`: new query `kind` (`drift` | `down`) and `acknowledged` (boolean); response adds `total`, and per item `monitorName`, `severity` (the last drift's max severity for drift incidents, null for down).
- `GET /v1/incidents/counts`: `{ open, acknowledged, resolved, drift, down }` for the tenant (open counts exclude acknowledged).
- `GET /v1/webhook-endpoints`: response adds `total`.

All are tenant-scoped like every `/v1` route. Totals are exact `count(*)` queries: tenants are small; the scaling path is to cap or estimate them past 10k rows (documented, not built).

## Constraints

- Onion layering and the dependency-cruiser rules stay as they are: health derivation in the domain, read queries in `packages/application/src/queries`, SQL in `packages/infrastructure/src/postgres`, HTTP in `apps/api`, no awilix outside apps.
- Every query uses an index that exists or is added in a new idempotent migration (`0003_...sql`), for example `probes (monitor_id, started_at desc)` already serves the recent-latency and stats queries.
- No new runtime dependencies in the dashboard or API. Dev dependencies only if a test needs one (none expected).
- Zero added cost: the extra requests are a handful per page view, inside the free tiers.
- Public repo hygiene: no em dashes, no personal data. Commits are made by Daniel; each adds its `COMMITS.md` entry.

## Testing

- Domain: `healthStateOf` table of every precedence case.
- Application: queries return the right health filter, search, totals and summaries with the in-memory adapters.
- Postgres: the same behaviour against the real database (health filter, search, totals, recent latencies order, stats with and without probes, incident filters and counts, tenant isolation).
- API: each new parameter and field, validation of `health`/`kind`/`q`, and tenant isolation.
- Dashboard (Vitest + Vue Test Utils, happy-dom): filters and search update the query and the request; pagination Next/Previous with the cursor stack; each row action calls the right endpoint and refreshes; the Add monitor dialog shows 400 problems; the webhook secret is shown once; untrusted text with `<script>` stays literal on every new view; the API key never appears in the URL.
- The existing e2e test must still pass unchanged.

## Calls made after the builder check (author's calls, not discussed)

1. `GET /v1/monitors/{monitorId}` also returns the same `summary` as list items, so the detail page reads health, open incident and latest probe from one call. `healthStateOf` stays the single source of the rule.
2. Incident filters map to the API as: Open = `state=open&acknowledged=false`, Acknowledged = `state=open&acknowledged=true`, Resolved = `state=resolved`. Acknowledging does not change a monitor's health (an acknowledged `down` incident still means `down`). The sidebar badge counts open unacknowledged incidents (what still needs attention); the Overview "open incidents" list shows all open ones, acknowledged marked as such.
3. Overview lists monitors whose health is `down` or `drift` (two filtered list calls, 10 each). It does not try to show single failed probes below the 3-failure threshold.
4. A list row's "Approve new baseline" first fetches `GET /v1/monitors/{id}/drift`, shows a confirmation dialog with the number of changes, their highest severity and the target hash (`toHash`, mono), and approves that hash. Nothing is approved blind.
5. Severity comes from the existing `drifts.max_severity` column through `incidents.last_drift_id`. An open drift incident always has a `last_drift_id`; if it were ever null, severity is null and the pill shows as critical (orange).
6. The URL query holds `page` (1-based) next to the cursor and page size, so "Showing a-b of total" survives a pasted link: a = (page - 1) x size + 1. Totals are recounted on every request; small changes between pages are acceptable.
7. `pending` excludes paused monitors; the health counts are exclusive and sum to `total`.
8. Interval is a select of 5, 15, 30 or 60 minutes (default 15), sent as seconds. The deployed scheduler runs on the quarter hour, so 5 minutes only takes effect in demo mode; the dialog says so in a one-line hint.
9. `recentLatenciesMs` is computed per request with a lateral subquery on `probes (monitor_id, started_at desc)`; no materialised column. Fine at the documented scale.

## Left to the builder

Component breakdown, the exact sparkline drawing, skeleton design, toast placement, and whether the dashboard's shared table/pagination lives in one component or two, as long as it is one implementation used by every list.
