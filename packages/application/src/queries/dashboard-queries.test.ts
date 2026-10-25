import {
  HEALTH_STATE_CASES,
  openIncident,
  acknowledgeIncident,
  resolveIncident,
  type Drift,
  type HealthState,
  type Incident,
  type IncidentKind,
  type Probe,
  type SnapshotHash,
} from '@keelson/domain';
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../shared/errors.js';
import type { IncidentFilter } from '../ports/index.js';
import {
  getHealthCounts,
  getIncidentCounts,
  getMonitorStats,
  getMonitorSummary,
  listIncidentViews,
  listMonitorSummaries,
  STATS_WINDOW_HOURS,
} from './dashboard-queries.js';
import { listProbes, listWebhookEndpoints } from './queries.js';
import { createHarness, MONITOR_ID, NOW, seedEndpoint, seedMonitor, TENANT_ID, type Harness } from '../test-support.js';

const OTHER_TENANT = 'ten_other';
const FIRST_PAGE = { cursor: null, limit: 50 };
const NO_MONITOR_FILTER = { health: null, search: null };
const NO_INCIDENT_FILTER: IncidentFilter = { state: null, kind: null, acknowledged: null };
const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const BASELINE_HASH = 'baseline' as SnapshotHash;

function minutesBeforeNow(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MILLISECONDS_PER_MINUTE);
}

function hoursBeforeNow(hours: number): Date {
  return minutesBeforeNow(hours * MINUTES_PER_HOUR);
}

async function seedProbe(
  harness: Harness,
  slot: number,
  overrides: Partial<Probe> = {},
  monitorId = MONITOR_ID,
): Promise<void> {
  await harness.db.probes.insertIfAbsent({
    id: `prb_${monitorId}_${String(slot)}`,
    monitorId,
    slot,
    startedAt: minutesBeforeNow(1000 - slot),
    latencyMs: 40,
    outcome: 'up',
    errorDetail: null,
    serverName: null,
    serverVersion: null,
    snapshotHash: null,
    ...overrides,
  });
}

async function seedIncident(
  harness: Harness,
  id: string,
  kind: IncidentKind,
  monitorId = MONITOR_ID,
  lastDriftId: string | null = null,
) {
  const incident = openIncident({ id, monitorId, kind, lastDriftId }, NOW);
  await harness.db.incidents.save(incident);
  return incident;
}

async function seedDrift(harness: Harness, id: string, maxSeverity: Drift['maxSeverity']): Promise<void> {
  await harness.db.drifts.insert({
    id,
    monitorId: MONITOR_ID,
    fromHash: BASELINE_HASH,
    toHash: 'current' as SnapshotHash,
    changes: [],
    maxSeverity,
    detectedAt: NOW,
  });
}

async function seedNamedMonitor(harness: Harness, id: string, name: string, url: string, overrides = {}) {
  return seedMonitor(harness, { id, name, url, ...overrides });
}

describe('listMonitorSummaries', () => {
  it('filters by health and search, case-insensitively, and returns the total of the filtered set', async () => {
    const harness = createHarness();
    await seedNamedMonitor(harness, 'mon_a', 'Alpha Docs', 'https://one.example.com/mcp');
    await seedNamedMonitor(harness, 'mon_b', 'Beta', 'https://two.example.com/mcp');
    await seedNamedMonitor(harness, 'mon_c', 'ALPHA search', 'https://three.example.com/mcp', { status: 'paused' });
    await seedProbe(harness, 1, {}, 'mon_a');

    const idsOf = async (filter: { health: 'up' | 'paused' | null; search: string | null }, limit = 50) => {
      const page = await listMonitorSummaries(harness.db, { tenantId: TENANT_ID, filter, page: { cursor: null, limit } });
      return { ids: page.items.map((summary) => summary.monitor.id).sort(), total: page.total };
    };

    expect(await idsOf({ health: 'up', search: null })).toEqual({ ids: ['mon_a'], total: 1 });
    expect(await idsOf({ health: null, search: 'alpha' })).toEqual({ ids: ['mon_a', 'mon_c'], total: 2 });
    expect(await idsOf({ health: null, search: 'THREE.example' })).toEqual({ ids: ['mon_c'], total: 1 });
    expect(await idsOf({ health: 'paused', search: 'alpha' })).toEqual({ ids: ['mon_c'], total: 1 });
    expect(await idsOf({ health: null, search: 'alpha' }, 1)).toMatchObject({ total: 2 });
  });

  it('trims the search and ignores a blank one', async () => {
    const harness = createHarness();
    await seedNamedMonitor(harness, 'mon_a', 'Alpha', 'https://one.example.com/mcp');
    await seedNamedMonitor(harness, 'mon_b', 'Beta', 'https://two.example.com/mcp');

    const search = async (text: string) =>
      (await listMonitorSummaries(harness.db, { tenantId: TENANT_ID, filter: { health: null, search: text }, page: FIRST_PAGE })).total;

    expect(await search('   ')).toBe(2);
    expect(await search('  beta  ')).toBe(1);
  });

  it('lists only the tenant\'s own monitors', async () => {
    const harness = createHarness();
    await seedMonitor(harness);
    await seedMonitor(harness, { id: 'mon_foreign', tenantId: OTHER_TENANT });

    const page = await listMonitorSummaries(harness.db, { tenantId: TENANT_ID, filter: NO_MONITOR_FILTER, page: FIRST_PAGE });

    expect(page.items.map((summary) => summary.monitor.id)).toEqual([MONITOR_ID]);
    expect(page.total).toBe(1);
  });
});

describe('getMonitorSummary', () => {
  it('carries the latest probe, up to 24 recent latencies oldest first with null for failed probes, the baseline tool count, and the open incident with its severity', async () => {
    const harness = createHarness();
    await seedMonitor(harness, { baselineHash: BASELINE_HASH });
    await harness.db.snapshots.saveIfAbsent({
      hash: BASELINE_HASH,
      catalog: {
        tools: [
          { name: 'a', description: '', inputSchema: {} },
          { name: 'b', description: '', inputSchema: {} },
        ],
        prompts: [],
        resources: [],
      },
    });
    for (let slot = 1; slot <= 26; slot += 1) {
      const failed: Partial<Probe> = slot === 4 ? { outcome: 'timeout', latencyMs: 9999 } : {};
      await seedProbe(harness, slot, { latencyMs: 100 + slot, ...failed });
    }
    await seedDrift(harness, 'drf_1', 'critical');
    await seedIncident(harness, 'inc_1', 'drift', MONITOR_ID, 'drf_1');

    const summary = await getMonitorSummary(harness.db, { tenantId: TENANT_ID, monitorId: MONITOR_ID });

    const expectedLatencies = Array.from({ length: 24 }, (_, index) => (index + 3 === 4 ? null : 100 + index + 3));
    expect(summary.recentLatenciesMs).toEqual(expectedLatencies);
    expect(summary.latestProbe).toEqual({ outcome: 'up', startedAt: minutesBeforeNow(1000 - 26), latencyMs: 126 });
    expect(summary.toolCount).toBe(2);
    expect(summary.openIncident).toEqual({ id: 'inc_1', kind: 'drift', severity: 'critical' });
    expect(summary.health).toBe('drift');
  });

  it('is empty for a monitor that was never probed, has no baseline and no incident', async () => {
    const harness = createHarness();
    await seedMonitor(harness);

    const summary = await getMonitorSummary(harness.db, { tenantId: TENANT_ID, monitorId: MONITOR_ID });

    expect(summary).toMatchObject({
      health: 'pending',
      latestProbe: null,
      recentLatenciesMs: [],
      toolCount: null,
      openIncident: null,
    });
  });

  it('reports a down incident without a severity', async () => {
    const harness = createHarness();
    await seedMonitor(harness);
    await seedIncident(harness, 'inc_1', 'down');

    const summary = await getMonitorSummary(harness.db, { tenantId: TENANT_ID, monitorId: MONITOR_ID });

    expect(summary.openIncident).toEqual({ id: 'inc_1', kind: 'down', severity: null });
  });
});

describe('getHealthCounts', () => {
  it('counts are exclusive and sum to total', async () => {
    const harness = createHarness();
    await seedNamedMonitor(harness, 'mon_up', 'Up', 'https://a.example.com/mcp');
    await seedProbe(harness, 1, {}, 'mon_up');
    await seedNamedMonitor(harness, 'mon_drift', 'Drift', 'https://b.example.com/mcp');
    await seedIncident(harness, 'inc_drift', 'drift', 'mon_drift');
    await seedNamedMonitor(harness, 'mon_down', 'Down', 'https://c.example.com/mcp');
    await seedIncident(harness, 'inc_down', 'down', 'mon_down');
    await seedNamedMonitor(harness, 'mon_paused', 'Paused', 'https://d.example.com/mcp', { status: 'paused' });
    await seedNamedMonitor(harness, 'mon_pending_1', 'Pending 1', 'https://e.example.com/mcp');
    await seedNamedMonitor(harness, 'mon_pending_2', 'Pending 2', 'https://f.example.com/mcp');
    await seedMonitor(harness, { id: 'mon_foreign', tenantId: OTHER_TENANT });

    const counts = await getHealthCounts(harness.db, { tenantId: TENANT_ID });

    expect(counts).toEqual({ up: 1, drift: 1, down: 1, paused: 1, pending: 2, total: 6 });
  });
});

describe('getMonitorStats', () => {
  it('counts only probes in the last 24 h; p95 uses up probes only; both null without probes', async () => {
    const harness = createHarness();
    await seedMonitor(harness);

    const empty = await getMonitorStats(harness.db, { tenantId: TENANT_ID, monitorId: MONITOR_ID, now: NOW });
    expect(empty).toEqual({ windowHours: STATS_WINDOW_HOURS, probes: 0, uptimeRatio: null, p95LatencyMs: null });

    await seedProbe(harness, 1, { startedAt: hoursBeforeNow(25), latencyMs: 5000 });
    await seedProbe(harness, 2, { startedAt: hoursBeforeNow(23), latencyMs: 100 });
    await seedProbe(harness, 3, { startedAt: hoursBeforeNow(1), latencyMs: 300 });
    await seedProbe(harness, 4, { startedAt: minutesBeforeNow(30), latencyMs: 9999, outcome: 'timeout' });

    const stats = await getMonitorStats(harness.db, { tenantId: TENANT_ID, monitorId: MONITOR_ID, now: NOW });

    expect(stats).toEqual({ windowHours: 24, probes: 3, uptimeRatio: 2 / 3, p95LatencyMs: 300 });
  });

  it('has an uptime of zero and no p95 when every probe in the window failed', async () => {
    const harness = createHarness();
    await seedMonitor(harness);
    await seedProbe(harness, 1, { startedAt: minutesBeforeNow(30), outcome: 'timeout' });

    const stats = await getMonitorStats(harness.db, { tenantId: TENANT_ID, monitorId: MONITOR_ID, now: NOW });

    expect(stats).toEqual({ windowHours: 24, probes: 1, uptimeRatio: 0, p95LatencyMs: null });
  });
});

describe('incident views', () => {
  async function seedIncidentMix(harness: Harness) {
    await seedMonitor(harness, { name: 'Docs server' });
    await seedNamedMonitor(harness, 'mon_2', 'Search server', 'https://two.example.com/mcp');
    await seedDrift(harness, 'drf_1', 'warning');
    // Acknowledged open drift, open down, open drift, and a resolved down.
    await harness.db.incidents.save(
      acknowledgeIncident(openIncident({ id: 'inc_ack', monitorId: MONITOR_ID, kind: 'drift', lastDriftId: 'drf_1' }, minutesBeforeNow(40)), NOW),
    );
    await harness.db.incidents.save(openIncident({ id: 'inc_down', monitorId: 'mon_2', kind: 'down', lastDriftId: null }, minutesBeforeNow(30)));
    await harness.db.incidents.save(openIncident({ id: 'inc_drift', monitorId: 'mon_2', kind: 'drift', lastDriftId: 'drf_1' }, minutesBeforeNow(20)));
    const resolvedDown = openIncident({ id: 'inc_old', monitorId: MONITOR_ID, kind: 'down', lastDriftId: null }, minutesBeforeNow(60));
    await harness.db.incidents.save(resolveIncident(resolvedDown, 'recovered', minutesBeforeNow(50)));
  }

  async function idsFor(harness: Harness, filter: Partial<IncidentFilter>): Promise<{ ids: string[]; total: number }> {
    const page = await listIncidentViews(harness.db, {
      tenantId: TENANT_ID,
      filter: { ...NO_INCIDENT_FILTER, ...filter },
      page: FIRST_PAGE,
    });
    return { ids: page.items.map((view) => view.incident.id), total: page.total };
  }

  it('carry the monitor name and drift severity; filters combine state, kind and acknowledged; counts exclude acknowledged from open', async () => {
    const harness = createHarness();
    await seedIncidentMix(harness);

    const page = await listIncidentViews(harness.db, { tenantId: TENANT_ID, filter: NO_INCIDENT_FILTER, page: FIRST_PAGE });
    expect(page.items.map((view) => [view.incident.id, view.monitorName, view.severity])).toEqual([
      ['inc_drift', 'Search server', 'warning'],
      ['inc_down', 'Search server', null],
      ['inc_ack', 'Docs server', 'warning'],
      ['inc_old', 'Docs server', null],
    ]);

    expect(await idsFor(harness, { state: 'open' })).toEqual({ ids: ['inc_drift', 'inc_down', 'inc_ack'], total: 3 });
    expect(await idsFor(harness, { state: 'open', kind: 'drift' })).toEqual({ ids: ['inc_drift', 'inc_ack'], total: 2 });
    expect(await idsFor(harness, { state: 'open', kind: 'drift', acknowledged: false })).toEqual({ ids: ['inc_drift'], total: 1 });
    expect(await idsFor(harness, { acknowledged: true })).toEqual({ ids: ['inc_ack'], total: 1 });
    expect(await idsFor(harness, { state: 'resolved' })).toEqual({ ids: ['inc_old'], total: 1 });

    expect(await getIncidentCounts(harness.db, { tenantId: TENANT_ID })).toEqual({
      open: 2,
      acknowledged: 1,
      resolved: 1,
      drift: 2,
      down: 1,
    });
  });

  it('never include another tenant\'s incidents', async () => {
    const harness = createHarness();
    await seedIncidentMix(harness);

    const foreign = await listIncidentViews(harness.db, { tenantId: OTHER_TENANT, filter: NO_INCIDENT_FILTER, page: FIRST_PAGE });
    const foreignCounts = await getIncidentCounts(harness.db, { tenantId: OTHER_TENANT });

    expect(foreign).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(foreignCounts).toEqual({ open: 0, acknowledged: 0, resolved: 0, drift: 0, down: 0 });
  });
});

describe('tenant isolation', () => {
  it('another tenant\'s monitor is NotFoundError for summary and stats', async () => {
    const harness = createHarness();
    await seedMonitor(harness);
    const foreign = { tenantId: OTHER_TENANT, monitorId: MONITOR_ID };

    await expect(getMonitorSummary(harness.db, foreign)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMonitorStats(harness.db, { ...foreign, now: NOW })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a monitor that does not exist is NotFoundError', async () => {
    const harness = createHarness();

    await expect(getMonitorSummary(harness.db, { tenantId: TENANT_ID, monitorId: 'mon_missing' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('totals on the existing listings', () => {
  it('listProbes and listWebhookEndpoints now include total', async () => {
    const harness = createHarness();
    await seedMonitor(harness);
    for (const slot of [1, 2, 3]) await seedProbe(harness, slot);
    for (const id of ['whk_1', 'whk_2', 'whk_3']) await seedEndpoint(harness, id);
    const smallPage = { cursor: null, limit: 2 };

    const probes = await listProbes(harness.db, { tenantId: TENANT_ID, monitorId: MONITOR_ID, page: smallPage });
    const endpoints = await listWebhookEndpoints(harness.db, { tenantId: TENANT_ID, page: smallPage });

    expect([probes.items.length, probes.total]).toEqual([2, 3]);
    expect([endpoints.items.length, endpoints.total]).toEqual([2, 3]);
  });
});

describe('in-memory monitor directory health and incident lifecycle', () => {
  const lifecycleCases: Array<{ name: string; incident: (id: string) => Incident; expected: HealthState }> = [
    {
      name: 'an acknowledged open down incident still gives down',
      incident: (id) => acknowledgeIncident(openIncident({ id, monitorId: MONITOR_ID, kind: 'down', lastDriftId: null }, NOW), NOW),
      expected: 'down',
    },
    {
      name: 'a resolved down incident gives up',
      incident: (id) =>
        resolveIncident(openIncident({ id, monitorId: MONITOR_ID, kind: 'down', lastDriftId: null }, NOW), 'recovered', NOW),
      expected: 'up',
    },
  ];

  it.each(lifecycleCases)('$name, through the summary, the health filter and the health counts', async ({ incident, expected }) => {
    const harness = createHarness();
    await seedMonitor(harness);
    await seedProbe(harness, 1);
    await harness.db.incidents.save(incident('inc_1'));

    const summary = await getMonitorSummary(harness.db, { tenantId: TENANT_ID, monitorId: MONITOR_ID });
    const filtered = await listMonitorSummaries(harness.db, {
      tenantId: TENANT_ID,
      filter: { health: expected, search: null },
      page: FIRST_PAGE,
    });
    const counts = await getHealthCounts(harness.db, { tenantId: TENANT_ID });

    expect(summary.health).toBe(expected);
    expect(filtered.items.map((item) => item.monitor.id)).toEqual([MONITOR_ID]);
    expect(counts[expected]).toBe(1);
    expect(counts.total).toBe(1);
  });
});

describe('in-memory monitor directory health', () => {
  it.each(HEALTH_STATE_CASES)('$name', async ({ inputs, expected }) => {
    const harness = createHarness();
    await seedMonitor(harness, { status: inputs.status });
    if (inputs.hasProbe) await seedProbe(harness, 1);
    for (const kind of inputs.openIncidentKinds) await seedIncident(harness, `inc_${kind}`, kind);

    const summary = await getMonitorSummary(harness.db, { tenantId: TENANT_ID, monitorId: MONITOR_ID });
    const filtered = await listMonitorSummaries(harness.db, {
      tenantId: TENANT_ID,
      filter: { health: expected, search: null },
      page: FIRST_PAGE,
    });

    expect(summary.health).toBe(expected);
    expect(filtered.items.map((item) => item.monitor.id)).toEqual([MONITOR_ID]);
  });
});
