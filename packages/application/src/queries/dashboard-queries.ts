import { NotFoundError } from '../shared/errors.js';
import type {
  CountedPage,
  HealthCounts,
  IncidentCounts,
  IncidentFilter,
  IncidentView,
  MonitorFilter,
  MonitorSummary,
  PageRequest,
  ProbeStats,
  Transaction,
} from '../ports/index.js';
import { getMonitor } from './queries.js';

export const STATS_WINDOW_HOURS = 24;
// The longest search the API accepts; queries pass a search through untouched.
export const SEARCH_MAX_LENGTH = 100;

const MILLISECONDS_PER_HOUR = 3_600_000;

export function listMonitorSummaries(
  tx: Transaction,
  input: { tenantId: string; filter: MonitorFilter; page: PageRequest },
): Promise<CountedPage<MonitorSummary>> {
  const filter = { health: input.filter.health, search: normalisedSearch(input.filter.search) };
  return tx.monitorDirectory.listSummaries(input.tenantId, filter, input.page);
}

export async function getMonitorSummary(
  tx: Transaction,
  input: { tenantId: string; monitorId: string },
): Promise<MonitorSummary> {
  const summary = await tx.monitorDirectory.summaryOf(input.tenantId, input.monitorId);
  if (summary === null) throw new NotFoundError('monitor not found');
  return summary;
}

export function getHealthCounts(tx: Transaction, input: { tenantId: string }): Promise<HealthCounts> {
  return tx.monitorDirectory.healthCounts(input.tenantId);
}

export async function getMonitorStats(
  tx: Transaction,
  input: { tenantId: string; monitorId: string; now: Date },
): Promise<ProbeStats> {
  await getMonitor(tx, input);
  const since = new Date(input.now.getTime() - STATS_WINDOW_HOURS * MILLISECONDS_PER_HOUR);
  const stats = await tx.monitorDirectory.probeStats(input.monitorId, since);
  return { windowHours: STATS_WINDOW_HOURS, ...stats };
}

export function listIncidentViews(
  tx: Transaction,
  input: { tenantId: string; filter: IncidentFilter; page: PageRequest },
): Promise<CountedPage<IncidentView>> {
  return tx.incidentDirectory.list(input.tenantId, input.filter, input.page);
}

export function getIncidentCounts(tx: Transaction, input: { tenantId: string }): Promise<IncidentCounts> {
  return tx.incidentDirectory.counts(input.tenantId);
}

// A blank search means no search; the length limit is enforced at the API, which rejects an overlong query.
function normalisedSearch(search: string | null): string | null {
  const trimmed = search?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}
