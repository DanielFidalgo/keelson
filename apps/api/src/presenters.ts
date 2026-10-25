import type {
  CountedPage,
  CurrentDrift,
  HealthCounts,
  IncidentCounts,
  IncidentView,
  MonitorSummary,
  Page,
  ProbeStats,
} from '@keelson/application';
import type { Incident, Monitor, Probe, Snapshot, WebhookEndpoint } from '@keelson/domain';

// Each presenter names the fields of the response schema, so a field added to the domain object never
// reaches a client until the contract is changed on purpose. Secret references are never listed.

export function presentPage<Item, Presented>(page: Page<Item>, present: (item: Item) => Presented) {
  return { items: page.items.map(present), nextCursor: page.nextCursor };
}

// The total counts everything the filters match, so a client can show "a-b of total" without walking the pages.
export function presentCountedPage<Item, Presented>(page: CountedPage<Item>, present: (item: Item) => Presented) {
  return { ...presentPage(page, present), total: page.total };
}

export function presentMonitor(monitor: Monitor) {
  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    transport: monitor.transport,
    intervalSeconds: monitor.intervalSeconds,
    status: monitor.status,
    hasAuthSecret: monitor.authSecretRef !== null,
    baselineHash: monitor.baselineHash,
    consecutiveFailures: monitor.consecutiveFailures,
    nextProbeAt: monitor.nextProbeAt.toISOString(),
    createdAt: monitor.createdAt.toISOString(),
  };
}

export function presentMonitorSummary({ monitor, health, latestProbe, recentLatenciesMs, toolCount, openIncident }: MonitorSummary) {
  return {
    ...presentMonitor(monitor),
    summary: {
      health,
      latestProbe:
        latestProbe === null
          ? null
          : { outcome: latestProbe.outcome, startedAt: latestProbe.startedAt.toISOString(), latencyMs: latestProbe.latencyMs },
      recentLatenciesMs,
      toolCount,
      openIncident:
        openIncident === null ? null : { id: openIncident.id, kind: openIncident.kind, severity: openIncident.severity },
    },
  };
}

export function presentHealthCounts({ total, up, drift, down, paused, pending }: HealthCounts) {
  return { total, up, drift, down, paused, pending };
}

export function presentMonitorStats({ windowHours, probes, uptimeRatio, p95LatencyMs }: ProbeStats) {
  return { windowHours, probes, uptimeRatio, p95LatencyMs };
}

export function presentProbe(probe: Probe) {
  return {
    id: probe.id,
    slot: probe.slot,
    startedAt: probe.startedAt.toISOString(),
    latencyMs: probe.latencyMs,
    outcome: probe.outcome,
    errorDetail: probe.errorDetail,
    serverName: probe.serverName,
    serverVersion: probe.serverVersion,
    snapshotHash: probe.snapshotHash,
  };
}

export function presentSnapshot(snapshot: Snapshot) {
  return { hash: snapshot.hash, catalog: snapshot.catalog };
}

export function presentDrift(drift: CurrentDrift | null) {
  return { drift: drift === null ? null : { fromHash: drift.fromHash, toHash: drift.toHash, changes: drift.changes } };
}

export function presentIncident(incident: Incident) {
  return {
    id: incident.id,
    monitorId: incident.monitorId,
    kind: incident.kind,
    state: incident.state,
    openedAt: incident.openedAt.toISOString(),
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    resolution: incident.resolution,
    acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
    lastDriftId: incident.lastDriftId,
  };
}

export function presentIncidentView({ incident, monitorName, severity }: IncidentView) {
  return { ...presentIncident(incident), monitorName, severity };
}

export function presentIncidentCounts({ open, acknowledged, resolved, drift, down }: IncidentCounts) {
  return { open, acknowledged, resolved, drift, down };
}

export function presentWebhookEndpoint(endpoint: WebhookEndpoint) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    format: endpoint.format,
    status: endpoint.status,
    consecutiveFailures: endpoint.consecutiveFailures,
    createdAt: endpoint.createdAt.toISOString(),
  };
}
