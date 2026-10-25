import { HEALTH_STATES, type HealthState, type IncidentKind, type ProbeOutcome, type Severity } from '@keelson/domain';
import {
  RECENT_LATENCY_PROBES,
  type CountedPage,
  type HealthCounts,
  type MonitorDirectory,
  type MonitorFilter,
  type MonitorSummary,
  type PageRequest,
  type ProbeWindowStats,
} from '@keelson/application';
import { toMonitor, type MonitorRow } from './monitor-repository.js';
import { selectCountedPage } from './paging.js';
import { firstOrNull, type Queryable, type RepositoryDeps } from './queryable.js';

// `kind` is a typed constant, never user input, so interpolating it into the SQL is safe.
function openIncidentOfKind(kind: IncidentKind): string {
  return `exists (select 1 from incidents i where i.monitor_id = m.id and i.state = 'open' and i.kind = '${kind}')`;
}

// The single SQL statement of the health rule in `healthStateOf` (first match wins), shared by listing, filtering and
// counting so they cannot disagree. The parity test runs it over the domain's HEALTH_STATE_CASES.
const MONITOR_HEALTH_CTE = `with monitor_health as (
  select m.*,
    case
      when m.status = 'paused' then 'paused'
      when ${openIncidentOfKind('down')} then 'down'
      when ${openIncidentOfKind('drift')} then 'drift'
      when not exists (select 1 from probes p where p.monitor_id = m.id) then 'pending'
      else 'up'
    end as health
  from monitors m
  where m.tenant_id = $1
)`;

// RECENT_LATENCY_PROBES is an internal constant, never user input, so it is interpolated rather than bound.
const SUMMARY_SELECT = `${MONITOR_HEALTH_CTE}
select h.*,
  latest.outcome as latest_outcome,
  latest.started_at as latest_started_at,
  latest.latency_ms as latest_latency_ms,
  recent.latencies as recent_latencies,
  jsonb_array_length(baseline.canonical -> 'tools') as tool_count,
  open_incident.id as open_incident_id,
  open_incident.kind as open_incident_kind,
  open_incident_drift.max_severity as open_incident_severity
from monitor_health h
left join lateral (
  select p.outcome, p.started_at, p.latency_ms
  from probes p where p.monitor_id = h.id
  order by p.started_at desc, p.id desc limit 1
) latest on true
left join lateral (
  select coalesce(array_agg(case when newest.outcome = 'up' then newest.latency_ms end order by newest.started_at, newest.id), '{}'::int[]) as latencies
  from (
    select p.outcome, p.latency_ms, p.started_at, p.id
    from probes p where p.monitor_id = h.id
    order by p.started_at desc, p.id desc limit ${String(RECENT_LATENCY_PROBES)}
  ) newest
) recent on true
left join snapshots baseline on baseline.hash = h.baseline_hash
left join lateral (
  select i.id, i.kind, i.last_drift_id
  from incidents i where i.monitor_id = h.id and i.state = 'open'
  order by (i.kind = 'down') desc limit 1
) open_incident on true
left join drifts open_incident_drift on open_incident_drift.id = open_incident.last_drift_id`;

const SUMMARY_COUNT_SELECT = `${MONITOR_HEALTH_CTE} select h.id from monitor_health h`;

interface MonitorSummaryRow extends MonitorRow {
  health: HealthState;
  latest_outcome: ProbeOutcome | null;
  latest_started_at: Date | null;
  latest_latency_ms: number | null;
  recent_latencies: (number | null)[];
  tool_count: number | null;
  open_incident_id: string | null;
  open_incident_kind: IncidentKind | null;
  open_incident_severity: Severity | null;
}

function toMonitorSummary(row: MonitorSummaryRow): MonitorSummary {
  return {
    monitor: toMonitor(row),
    health: row.health,
    latestProbe:
      row.latest_outcome === null || row.latest_started_at === null || row.latest_latency_ms === null
        ? null
        : { outcome: row.latest_outcome, startedAt: row.latest_started_at, latencyMs: row.latest_latency_ms },
    recentLatenciesMs: row.recent_latencies,
    toolCount: row.tool_count,
    openIncident:
      row.open_incident_id === null || row.open_incident_kind === null
        ? null
        : { id: row.open_incident_id, kind: row.open_incident_kind, severity: row.open_incident_severity },
  };
}

interface ProbeStatsRow {
  probes: number;
  up_probes: number;
  p95_latency_ms: number | null;
}

// Interpolated into the SQL as an internal constant, never user input.
const P95 = 0.95;

// The backslash is the declared escape character of the LIKE patterns, so it must be escaped along with the wildcards.
function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class PostgresMonitorDirectory implements MonitorDirectory {
  private readonly db: Queryable;

  constructor({ db }: RepositoryDeps) {
    this.db = db;
  }

  listSummaries(tenantId: string, filter: MonitorFilter, page: PageRequest): Promise<CountedPage<MonitorSummary>> {
    const values: unknown[] = [tenantId];
    const conditions: string[] = [];
    if (filter.health !== null) {
      values.push(filter.health);
      conditions.push(`h.health = $${String(values.length)}`);
    }
    if (filter.search !== null) {
      values.push(`%${escapeLikePattern(filter.search)}%`);
      const pattern = `$${String(values.length)}`;
      conditions.push(`(h.name ilike ${pattern} escape '\\' or h.url ilike ${pattern} escape '\\')`);
    }
    return selectCountedPage<MonitorSummaryRow, MonitorSummary>(
      this.db,
      {
        select: SUMMARY_SELECT,
        countSelect: SUMMARY_COUNT_SELECT,
        conditions,
        values,
        sortColumn: 'h.created_at',
        sortType: 'timestamptz',
        idColumn: 'h.id',
        sortKeyOf: (row) => row.created_at.toISOString(),
      },
      page,
      toMonitorSummary,
    );
  }

  async summaryOf(tenantId: string, monitorId: string): Promise<MonitorSummary | null> {
    const { rows } = await this.db.query<MonitorSummaryRow>(`${SUMMARY_SELECT} where h.id = $2`, [tenantId, monitorId]);
    return firstOrNull(rows, toMonitorSummary);
  }

  async healthCounts(tenantId: string): Promise<HealthCounts> {
    const { rows } = await this.db.query<{ health: HealthState; total: number }>(
      `${MONITOR_HEALTH_CTE} select health, count(*)::int as total from monitor_health group by health`,
      [tenantId],
    );
    const counts = Object.fromEntries(HEALTH_STATES.map((state) => [state, 0])) as HealthCounts;
    for (const row of rows) counts[row.health] = row.total;
    return { ...counts, total: rows.reduce((sum, row) => sum + row.total, 0) };
  }

  async probeStats(monitorId: string, since: Date): Promise<ProbeWindowStats> {
    // Nearest-rank percentile, so the value is always a latency that was actually measured.
    const { rows } = await this.db.query<ProbeStatsRow>(
      `select count(*)::int as probes,
              (count(*) filter (where outcome = 'up'))::int as up_probes,
              percentile_disc(${String(P95)}) within group (order by latency_ms) filter (where outcome = 'up') as p95_latency_ms
       from probes where monitor_id = $1 and started_at >= $2`,
      [monitorId, since],
    );
    const stats = rows[0];
    if (stats === undefined || stats.probes === 0) return { probes: 0, uptimeRatio: null, p95LatencyMs: null };
    return { probes: stats.probes, uptimeRatio: stats.up_probes / stats.probes, p95LatencyMs: stats.p95_latency_ms };
  }
}
