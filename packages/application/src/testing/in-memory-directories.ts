import { compareCodeUnits, HEALTH_STATES, healthStateOf } from '@keelson/domain';
import type { Incident, IncidentKind, Monitor, Probe } from '@keelson/domain';
import {
  RECENT_LATENCY_PROBES,
  type CountedPage,
  type HealthCounts,
  type IncidentCounts,
  type IncidentDirectory,
  type IncidentFilter,
  type IncidentView,
  type MonitorDirectory,
  type MonitorFilter,
  type MonitorSummary,
  type PageRequest,
  type ProbeWindowStats,
} from '../ports/index.js';
import {
  paginateCounted,
  type InMemoryDrifts,
  type InMemoryIncidents,
  type InMemoryMonitors,
  type InMemoryProbes,
  type InMemorySnapshots,
} from './in-memory-repositories.js';

const P95 = 0.95;

export interface InMemoryMonitorDirectoryDeps {
  monitors: InMemoryMonitors;
  probes: InMemoryProbes;
  incidents: InMemoryIncidents;
  drifts: InMemoryDrifts;
  snapshots: InMemorySnapshots;
}

export class InMemoryMonitorDirectory implements MonitorDirectory {
  private readonly deps: InMemoryMonitorDirectoryDeps;

  constructor(deps: InMemoryMonitorDirectoryDeps) {
    this.deps = deps;
  }

  listSummaries(tenantId: string, filter: MonitorFilter, page: PageRequest): Promise<CountedPage<MonitorSummary>> {
    const matching = this.ownedBy(tenantId)
      .map((monitor) => this.summarise(monitor))
      .filter((summary) => filter.health === null || summary.health === filter.health)
      .filter((summary) => filter.search === null || matchesSearch(summary.monitor, filter.search));
    return Promise.resolve(paginateCounted(matching, page, (summary) => summary.monitor.id));
  }

  summaryOf(tenantId: string, monitorId: string): Promise<MonitorSummary | null> {
    const monitor = this.deps.monitors.records.get(monitorId);
    return Promise.resolve(monitor?.tenantId === tenantId ? this.summarise(monitor) : null);
  }

  healthCounts(tenantId: string): Promise<HealthCounts> {
    const counts = Object.fromEntries(HEALTH_STATES.map((state) => [state, 0])) as HealthCounts;
    const monitors = this.ownedBy(tenantId);
    for (const monitor of monitors) counts[this.summarise(monitor).health] += 1;
    return Promise.resolve({ ...counts, total: monitors.length });
  }

  probeStats(monitorId: string, since: Date): Promise<ProbeWindowStats> {
    const inWindow = this.deps.probes.forMonitor(monitorId).filter((probe) => probe.startedAt >= since);
    const upLatencies = inWindow.filter((probe) => probe.outcome === 'up').map((probe) => probe.latencyMs);
    return Promise.resolve({
      probes: inWindow.length,
      uptimeRatio: inWindow.length === 0 ? null : upLatencies.length / inWindow.length,
      p95LatencyMs: nearestRank(upLatencies, P95),
    });
  }

  private ownedBy(tenantId: string): Monitor[] {
    return [...this.deps.monitors.records.values()]
      .filter((monitor) => monitor.tenantId === tenantId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || compareCodeUnits(right.id, left.id));
  }

  private summarise(monitor: Monitor): MonitorSummary {
    const probes = this.deps.probes.forMonitor(monitor.id);
    const openIncidents = [...this.deps.incidents.records.values()].filter(
      (incident) => incident.monitorId === monitor.id && incident.state === 'open',
    );
    const [latest] = probes;
    const shown = shownIncident(openIncidents);
    return {
      monitor,
      health: healthStateOf({
        status: monitor.status,
        hasProbe: latest !== undefined,
        openIncidentKinds: openIncidents.map((incident) => incident.kind),
      }),
      latestProbe: latest === undefined ? null : { outcome: latest.outcome, startedAt: latest.startedAt, latencyMs: latest.latencyMs },
      recentLatenciesMs: probes.slice(0, RECENT_LATENCY_PROBES).reverse().map(latencyOfUpProbe),
      toolCount: this.toolCountOf(monitor),
      openIncident:
        shown === undefined ? null : { id: shown.id, kind: shown.kind, severity: this.severityOf(shown) },
    };
  }

  private toolCountOf(monitor: Monitor): number | null {
    if (monitor.baselineHash === null) return null;
    return this.deps.snapshots.records.get(monitor.baselineHash)?.catalog.tools.length ?? null;
  }

  private severityOf(incident: Incident): IncidentView['severity'] {
    if (incident.lastDriftId === null) return null;
    return this.deps.drifts.records.get(incident.lastDriftId)?.maxSeverity ?? null;
  }
}

export interface InMemoryIncidentDirectoryDeps {
  monitors: InMemoryMonitors;
  incidents: InMemoryIncidents;
  drifts: InMemoryDrifts;
}

export class InMemoryIncidentDirectory implements IncidentDirectory {
  private readonly deps: InMemoryIncidentDirectoryDeps;

  constructor(deps: InMemoryIncidentDirectoryDeps) {
    this.deps = deps;
  }

  list(tenantId: string, filter: IncidentFilter, page: PageRequest): Promise<CountedPage<IncidentView>> {
    const matching = this.viewsOf(tenantId).filter((view) => matchesFilter(view.incident, filter));
    return Promise.resolve(paginateCounted(matching, page, (view) => view.incident.id));
  }

  counts(tenantId: string): Promise<IncidentCounts> {
    const incidents = this.viewsOf(tenantId).map((view) => view.incident);
    const open = incidents.filter((incident) => incident.state === 'open');
    const openOfKind = (kind: IncidentKind): number => open.filter((incident) => incident.kind === kind).length;
    return Promise.resolve({
      open: open.filter((incident) => incident.acknowledgedAt === null).length,
      acknowledged: open.filter((incident) => incident.acknowledgedAt !== null).length,
      resolved: incidents.length - open.length,
      drift: openOfKind('drift'),
      down: openOfKind('down'),
    });
  }

  private viewsOf(tenantId: string): IncidentView[] {
    const views: IncidentView[] = [];
    for (const incident of this.deps.incidents.records.values()) {
      const monitor = this.deps.monitors.records.get(incident.monitorId);
      if (monitor?.tenantId !== tenantId) continue;
      const drift = incident.lastDriftId === null ? undefined : this.deps.drifts.records.get(incident.lastDriftId);
      views.push({ incident, monitorName: monitor.name, severity: drift?.maxSeverity ?? null });
    }
    return views.sort(
      (left, right) =>
        right.incident.openedAt.getTime() - left.incident.openedAt.getTime() ||
        compareCodeUnits(right.incident.id, left.incident.id),
    );
  }
}

function matchesFilter(incident: Incident, filter: IncidentFilter): boolean {
  return (
    (filter.state === null || incident.state === filter.state) &&
    (filter.kind === null || incident.kind === filter.kind) &&
    (filter.acknowledged === null || (incident.acknowledgedAt !== null) === filter.acknowledged)
  );
}

function matchesSearch(monitor: Monitor, search: string): boolean {
  const needle = search.toLowerCase();
  return monitor.name.toLowerCase().includes(needle) || monitor.url.toLowerCase().includes(needle);
}

// A failed probe's latency is how long it took to give up, which would distort a latency trend.
function latencyOfUpProbe(probe: Probe): number | null {
  return probe.outcome === 'up' ? probe.latencyMs : null;
}

// Down outranks drift, matching the precedence of the health rule.
function shownIncident(openIncidents: readonly Incident[]): Incident | undefined {
  return openIncidents.find((incident) => incident.kind === 'down') ?? openIncidents[0];
}

function nearestRank(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(quantile * sorted.length) - 1] ?? null;
}
