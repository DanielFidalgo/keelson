import type {
  HealthState,
  Incident,
  IncidentKind,
  Monitor,
  ProbeOutcome,
  Severity,
} from '@keelson/domain';
import type { CountedPage, PageRequest } from './repositories.js';

export const RECENT_LATENCY_PROBES = 24;

export interface LatestProbe {
  outcome: ProbeOutcome;
  startedAt: Date;
  latencyMs: number;
}

export interface MonitorSummary {
  monitor: Monitor;
  health: HealthState;
  latestProbe: LatestProbe | null;
  // Oldest first, so a chart reads left to right; null marks a probe that failed and so has no meaningful latency.
  recentLatenciesMs: (number | null)[];
  // Null until a baseline is approved; the baseline is what the monitor is held to.
  toolCount: number | null;
  openIncident: { id: string; kind: IncidentKind; severity: Severity | null } | null;
}

export interface MonitorFilter {
  health: HealthState | null;
  search: string | null;
}

export type HealthCounts = Record<HealthState, number> & { total: number };

export interface ProbeStats {
  windowHours: number;
  probes: number;
  uptimeRatio: number | null;
  p95LatencyMs: number | null;
}

// The window length is the caller's policy, expressed by `since`, so the directory reports only what it measured.
export type ProbeWindowStats = Omit<ProbeStats, 'windowHours'>;

export interface MonitorDirectory {
  listSummaries(tenantId: string, filter: MonitorFilter, page: PageRequest): Promise<CountedPage<MonitorSummary>>;
  summaryOf(tenantId: string, monitorId: string): Promise<MonitorSummary | null>;
  healthCounts(tenantId: string): Promise<HealthCounts>;
  probeStats(monitorId: string, since: Date): Promise<ProbeWindowStats>;
}

export interface IncidentView {
  incident: Incident;
  monitorName: string;
  // Only a drift incident has a severity, taken from its latest drift.
  severity: Severity | null;
}

export interface IncidentFilter {
  state: 'open' | 'resolved' | null;
  kind: IncidentKind | null;
  acknowledged: boolean | null;
}

// `open` excludes acknowledged incidents so the three state counts never overlap; `drift` and `down` count open
// incidents of that kind whether or not they are acknowledged.
export interface IncidentCounts {
  open: number;
  acknowledged: number;
  resolved: number;
  drift: number;
  down: number;
}

export interface IncidentDirectory {
  list(tenantId: string, filter: IncidentFilter, page: PageRequest): Promise<CountedPage<IncidentView>>;
  counts(tenantId: string): Promise<IncidentCounts>;
}
