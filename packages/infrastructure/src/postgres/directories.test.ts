import { fileURLToPath } from 'node:url';
import {
  acknowledgeIncident,
  HEALTH_STATE_CASES,
  newMonitor,
  newWebhookEndpoint,
  openIncident,
  resolveIncident,
  type Drift,
  type HealthState,
  type Incident,
  type IncidentKind,
  type Monitor,
  type Probe,
  type Snapshot,
  type SnapshotHash,
} from '@keelson/domain';
import type { IncidentFilter, MonitorFilter, PageRequest } from '@keelson/application';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from './pool.js';
import { migrate } from './migrations.js';
import { PostgresUnitOfWork } from './unit-of-work.js';

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../migrations', import.meta.url));
const NOW = new Date('2026-10-22T12:00:00.000Z');
const TENANT_ID = 'ten_1';
const OTHER_TENANT = 'ten_other';
const MONITOR_ID = 'mon_1';
const FIRST_PAGE: PageRequest = { cursor: null, limit: 50 };
const NO_MONITOR_FILTER: MonitorFilter = { health: null, search: null };
const NO_INCIDENT_FILTER: IncidentFilter = { state: null, kind: null, acknowledged: null };
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const BASELINE_HASH = 'baseline' as SnapshotHash;
const RECENT_PROBES = 24;

let container: StartedPostgreSqlContainer;
let pool: Pool;
let unitOfWork: PostgresUnitOfWork;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  pool = createPool(container.getConnectionUri());
  await migrate({ databaseUrl: container.getConnectionUri(), directory: MIGRATIONS_DIRECTORY });
  unitOfWork = new PostgresUnitOfWork({ pool });
}, CONTAINER_STARTUP_TIMEOUT_MS);

afterAll(async () => {
  await pool.end();
  await container.stop();
});

beforeEach(async () => {
  await pool.query('truncate tenants, snapshots cascade');
  await unitOfWork.run(async (tx) => {
    await tx.tenants.insert({ id: TENANT_ID, name: 'Acme' });
    await tx.tenants.insert({ id: OTHER_TENANT, name: 'Other' });
  });
});

function minutesBeforeNow(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MILLISECONDS_PER_MINUTE);
}

function hoursBeforeNow(hours: number): Date {
  return minutesBeforeNow(hours * MINUTES_PER_HOUR);
}

function buildMonitor(overrides: Partial<Monitor> = {}): Monitor {
  const id = overrides.id ?? MONITOR_ID;
  const monitor = newMonitor(
    { id, tenantId: TENANT_ID, name: `Monitor ${id}`, url: `https://${id}.example.com/mcp`, intervalSeconds: 300, authSecretRef: null },
    NOW,
  );
  return { ...monitor, ...overrides };
}

function buildProbe(slot: number, overrides: Partial<Probe> = {}): Probe {
  const monitorId = overrides.monitorId ?? MONITOR_ID;
  return {
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
  };
}

function buildDrift(overrides: Partial<Drift> = {}): Drift {
  return {
    id: 'drf_1',
    monitorId: MONITOR_ID,
    fromHash: BASELINE_HASH,
    toHash: 'current' as SnapshotHash,
    changes: [],
    maxSeverity: 'critical',
    detectedAt: NOW,
    ...overrides,
  };
}

function buildSnapshot(toolNames: string[]): Snapshot {
  return {
    hash: BASELINE_HASH,
    catalog: {
      tools: toolNames.map((name) => ({ name, description: '', inputSchema: {} })),
      prompts: [],
      resources: [],
    },
  };
}

async function seedMonitors(...monitors: Monitor[]): Promise<void> {
  await unitOfWork.run(async (tx) => {
    for (const monitor of monitors) await tx.monitors.save(monitor);
  });
}

async function seedProbes(...probes: Probe[]): Promise<void> {
  await unitOfWork.run(async (tx) => {
    for (const probe of probes) await tx.probes.insertIfAbsent(probe);
  });
}

async function seedOpenIncident(id: string, kind: IncidentKind, monitorId = MONITOR_ID, lastDriftId: string | null = null) {
  await unitOfWork.run((tx) => tx.incidents.save(openIncident({ id, monitorId, kind, lastDriftId }, NOW)));
}

async function listSummaries(filter: MonitorFilter, page: PageRequest = FIRST_PAGE, tenantId = TENANT_ID) {
  return unitOfWork.run((tx) => tx.monitorDirectory.listSummaries(tenantId, filter, page));
}

async function summaryIds(filter: MonitorFilter, tenantId = TENANT_ID): Promise<string[]> {
  const page = await listSummaries(filter, FIRST_PAGE, tenantId);
  return page.items.map((summary) => summary.monitor.id).sort();
}

async function listIncidents(filter: Partial<IncidentFilter>, page: PageRequest = FIRST_PAGE, tenantId = TENANT_ID) {
  return unitOfWork.run((tx) => tx.incidentDirectory.list(tenantId, { ...NO_INCIDENT_FILTER, ...filter }, page));
}

describe('monitor directory', () => {
  it('filters by health and search, case-insensitively, and returns the total of the filtered set', async () => {
    await seedMonitors(
      buildMonitor({ id: 'mon_a', name: 'Alpha Docs', url: 'https://one.example.com/mcp' }),
      buildMonitor({ id: 'mon_b', name: 'Beta', url: 'https://two.example.com/mcp' }),
      buildMonitor({ id: 'mon_c', name: 'ALPHA search', url: 'https://three.example.com/mcp', status: 'paused' }),
    );
    await seedProbes(buildProbe(1, { monitorId: 'mon_a' }));

    expect(await summaryIds({ health: 'up', search: null })).toEqual(['mon_a']);
    expect(await summaryIds({ health: null, search: 'alpha' })).toEqual(['mon_a', 'mon_c']);
    expect(await summaryIds({ health: null, search: 'THREE.example' })).toEqual(['mon_c']);
    expect(await summaryIds({ health: 'paused', search: 'alpha' })).toEqual(['mon_c']);
    const firstOfTwo = await listSummaries({ health: null, search: 'alpha' }, { cursor: null, limit: 1 });
    expect([firstOfTwo.items.length, firstOfTwo.total]).toEqual([1, 2]);
  });

  it('search matches name or url case-insensitively and treats %, _ and \\ literally', async () => {
    await seedMonitors(
      buildMonitor({ id: 'mon_percent', name: 'a%b', url: 'https://one.example.com/mcp' }),
      buildMonitor({ id: 'mon_underscore', name: 'a_b', url: 'https://two.example.com/mcp' }),
      buildMonitor({ id: 'mon_backslash', name: 'a\\b', url: 'https://three.example.com/mcp' }),
      buildMonitor({ id: 'mon_plain', name: 'axb', url: 'https://four.example.com/mcp' }),
      buildMonitor({ id: 'mon_url', name: 'Other', url: 'https://five.example.com/Path_x' }),
    );

    expect(await summaryIds({ health: null, search: 'a%b' })).toEqual(['mon_percent']);
    expect(await summaryIds({ health: null, search: 'a_b' })).toEqual(['mon_underscore']);
    expect(await summaryIds({ health: null, search: 'a\\b' })).toEqual(['mon_backslash']);
    expect(await summaryIds({ health: null, search: '%' })).toEqual(['mon_percent']);
    expect(await summaryIds({ health: null, search: 'path_X' })).toEqual(['mon_url']);
  });

  it('parity: for every HEALTH_STATE_CASES row, the SQL health of a seeded monitor equals the case\'s expected value, and the health filter returns it', async () => {
    for (const [index, { inputs, expected }] of HEALTH_STATE_CASES.entries()) {
      const id = `mon_case_${String(index)}`;
      await seedMonitors(buildMonitor({ id, status: inputs.status }));
      if (inputs.hasProbe) await seedProbes(buildProbe(1, { monitorId: id }));
      for (const kind of inputs.openIncidentKinds) await seedOpenIncident(`inc_${id}_${kind}`, kind, id);

      const summary = await unitOfWork.run((tx) => tx.monitorDirectory.summaryOf(TENANT_ID, id));
      const filtered = await summaryIds({ health: expected, search: null });

      expect(summary?.health, HEALTH_STATE_CASES[index]?.name).toBe(expected);
      expect(filtered, HEALTH_STATE_CASES[index]?.name).toContain(id);
    }
  });

  it('parity: the health filter returns exactly the monitors of that health, and the counts agree', async () => {
    for (const [index, { inputs }] of HEALTH_STATE_CASES.entries()) {
      const id = `mon_case_${String(index)}`;
      await seedMonitors(buildMonitor({ id, status: inputs.status }));
      if (inputs.hasProbe) await seedProbes(buildProbe(1, { monitorId: id }));
      for (const kind of inputs.openIncidentKinds) await seedOpenIncident(`inc_${id}_${kind}`, kind, id);
    }
    const expectedIdsByHealth = new Map<HealthState, string[]>();
    for (const [index, { expected }] of HEALTH_STATE_CASES.entries()) {
      expectedIdsByHealth.set(expected, [...(expectedIdsByHealth.get(expected) ?? []), `mon_case_${String(index)}`]);
    }

    for (const [health, ids] of expectedIdsByHealth) {
      expect(await summaryIds({ health, search: null })).toEqual([...ids].sort());
    }
    const counts = await unitOfWork.run((tx) => tx.monitorDirectory.healthCounts(TENANT_ID));
    expect(counts).toEqual({
      up: expectedIdsByHealth.get('up')?.length,
      drift: expectedIdsByHealth.get('drift')?.length,
      down: expectedIdsByHealth.get('down')?.length,
      paused: expectedIdsByHealth.get('paused')?.length,
      pending: expectedIdsByHealth.get('pending')?.length,
      total: HEALTH_STATE_CASES.length,
    });
  });

  it.each([
    {
      name: 'an acknowledged open down incident still gives down',
      lifecycle: (incident: Incident) => acknowledgeIncident(incident, NOW),
      expected: 'down' as const,
    },
    {
      name: 'a resolved down incident gives up',
      lifecycle: (incident: Incident) => resolveIncident(incident, 'recovered', NOW),
      expected: 'up' as const,
    },
  ])('$name, through the summary, the health filter and the health counts', async ({ lifecycle, expected }) => {
    await seedMonitors(buildMonitor());
    await seedProbes(buildProbe(1));
    const incident = lifecycle(openIncident({ id: 'inc_1', monitorId: MONITOR_ID, kind: 'down', lastDriftId: null }, NOW));
    await unitOfWork.run((tx) => tx.incidents.save(incident));

    const summary = await unitOfWork.run((tx) => tx.monitorDirectory.summaryOf(TENANT_ID, MONITOR_ID));
    const counts = await unitOfWork.run((tx) => tx.monitorDirectory.healthCounts(TENANT_ID));

    expect(summary?.health).toBe(expected);
    expect(await summaryIds({ health: expected, search: null })).toEqual([MONITOR_ID]);
    expect(counts[expected]).toBe(1);
    expect(counts.total).toBe(1);
  });

  it('a summary carries the latest probe, the open incident with its severity and the baseline tool count', async () => {
    await seedMonitors(buildMonitor({ baselineHash: BASELINE_HASH }));
    await unitOfWork.run(async (tx) => {
      await tx.snapshots.saveIfAbsent(buildSnapshot(['search', 'fetch']), NOW);
      await tx.drifts.insert(buildDrift({ maxSeverity: 'warning' }));
    });
    await seedProbes(buildProbe(1, { latencyMs: 55 }), buildProbe(2, { latencyMs: 77, outcome: 'timeout' }));
    await seedOpenIncident('inc_1', 'drift', MONITOR_ID, 'drf_1');

    const summary = await unitOfWork.run((tx) => tx.monitorDirectory.summaryOf(TENANT_ID, MONITOR_ID));

    expect(summary).toMatchObject({
      health: 'drift',
      latestProbe: { outcome: 'timeout', startedAt: minutesBeforeNow(998), latencyMs: 77 },
      toolCount: 2,
      openIncident: { id: 'inc_1', kind: 'drift', severity: 'warning' },
    });
  });

  it('is empty for a monitor with no probes, baseline or incident, and reports a down incident without severity', async () => {
    await seedMonitors(buildMonitor());
    const empty = await unitOfWork.run((tx) => tx.monitorDirectory.summaryOf(TENANT_ID, MONITOR_ID));

    expect(empty).toMatchObject({ health: 'pending', latestProbe: null, recentLatenciesMs: [], toolCount: null, openIncident: null });

    await seedOpenIncident('inc_1', 'down');
    const down = await unitOfWork.run((tx) => tx.monitorDirectory.summaryOf(TENANT_ID, MONITOR_ID));

    expect(down?.openIncident).toEqual({ id: 'inc_1', kind: 'down', severity: null });
  });

  it('tool count reads the baseline snapshot\'s tools array length', async () => {
    await seedMonitors(buildMonitor({ id: 'mon_none' }), buildMonitor({ baselineHash: BASELINE_HASH }));
    await unitOfWork.run((tx) => tx.snapshots.saveIfAbsent(buildSnapshot(['a', 'b', 'c']), NOW));

    const withBaseline = await unitOfWork.run((tx) => tx.monitorDirectory.summaryOf(TENANT_ID, MONITOR_ID));
    const without = await unitOfWork.run((tx) => tx.monitorDirectory.summaryOf(TENANT_ID, 'mon_none'));

    expect([withBaseline?.toolCount, without?.toolCount]).toEqual([3, null]);
  });

  it('recent latencies come from the newest 24 probes, ordered oldest first, with null for failed probes', async () => {
    await seedMonitors(buildMonitor());
    const probes = Array.from({ length: RECENT_PROBES + 2 }, (_, index) => {
      const slot = index + 1;
      return buildProbe(slot, { latencyMs: 100 + slot, ...(slot === 4 ? { outcome: 'timeout' as const } : {}) });
    });
    await seedProbes(...probes);

    const summary = await unitOfWork.run((tx) => tx.monitorDirectory.summaryOf(TENANT_ID, MONITOR_ID));

    const expected = Array.from({ length: RECENT_PROBES }, (_, index) => (index + 3 === 4 ? null : 100 + index + 3));
    expect(summary?.recentLatenciesMs).toEqual(expected);
  });

  it('health counts are exclusive, sum to total and ignore other tenants', async () => {
    await seedMonitors(
      buildMonitor({ id: 'mon_up' }),
      buildMonitor({ id: 'mon_down' }),
      buildMonitor({ id: 'mon_paused', status: 'paused' }),
      buildMonitor({ id: 'mon_pending_1' }),
      buildMonitor({ id: 'mon_pending_2' }),
      buildMonitor({ id: 'mon_foreign', tenantId: OTHER_TENANT }),
    );
    await seedProbes(buildProbe(1, { monitorId: 'mon_up' }));
    await seedOpenIncident('inc_down', 'down', 'mon_down');

    const counts = await unitOfWork.run((tx) => tx.monitorDirectory.healthCounts(TENANT_ID));

    expect(counts).toEqual({ up: 1, drift: 0, down: 1, paused: 1, pending: 2, total: 5 });
  });

  it('pagination with a filter keeps the filter across pages and the total stays the filtered count', async () => {
    const upIds = ['mon_1', 'mon_2', 'mon_3', 'mon_4', 'mon_5'];
    await seedMonitors(
      ...upIds.map((id, index) => buildMonitor({ id, createdAt: minutesBeforeNow(100 - index) })),
      buildMonitor({ id: 'mon_pending_a' }),
      buildMonitor({ id: 'mon_pending_b' }),
    );
    await seedProbes(...upIds.map((id) => buildProbe(1, { monitorId: id })));
    const filter: MonitorFilter = { health: 'up', search: null };

    const first = await listSummaries(filter, { cursor: null, limit: 2 });
    const second = await listSummaries(filter, { cursor: first.nextCursor, limit: 2 });
    const third = await listSummaries(filter, { cursor: second.nextCursor, limit: 2 });

    expect([first, second, third].map((page) => page.items.map((summary) => summary.monitor.id))).toEqual([
      ['mon_5', 'mon_4'],
      ['mon_3', 'mon_2'],
      ['mon_1'],
    ]);
    expect([first.total, second.total, third.total]).toEqual([5, 5, 5]);
    expect(third.nextCursor).toBeNull();
  });

  it('monitor stats count only probes in the last 24 h; p95 uses up probes only; both null without probes', async () => {
    await seedMonitors(buildMonitor());
    const since = hoursBeforeNow(24);

    const empty = await unitOfWork.run((tx) => tx.monitorDirectory.probeStats(MONITOR_ID, since));
    expect(empty).toEqual({ probes: 0, uptimeRatio: null, p95LatencyMs: null });

    await seedProbes(
      buildProbe(1, { startedAt: hoursBeforeNow(25), latencyMs: 5000 }),
      buildProbe(2, { startedAt: hoursBeforeNow(23), latencyMs: 100 }),
      buildProbe(3, { startedAt: hoursBeforeNow(1), latencyMs: 300 }),
      buildProbe(4, { startedAt: minutesBeforeNow(30), latencyMs: 9999, outcome: 'timeout' }),
    );

    const stats = await unitOfWork.run((tx) => tx.monitorDirectory.probeStats(MONITOR_ID, since));

    expect(stats).toEqual({ probes: 3, uptimeRatio: 2 / 3, p95LatencyMs: 300 });
  });

  it('p95 is the nearest-rank value over the up probes', async () => {
    await seedMonitors(buildMonitor());
    await seedProbes(...Array.from({ length: 20 }, (_, index) => buildProbe(index + 1, { startedAt: minutesBeforeNow(index + 1), latencyMs: (index + 1) * 10 })));

    const stats = await unitOfWork.run((tx) => tx.monitorDirectory.probeStats(MONITOR_ID, hoursBeforeNow(24)));

    expect(stats.p95LatencyMs).toBe(190);
  });

  it('tenant isolation: another tenant sees no monitors, summaries or health', async () => {
    await seedMonitors(buildMonitor());
    await seedProbes(buildProbe(1));

    const summary = await unitOfWork.run((tx) => tx.monitorDirectory.summaryOf(OTHER_TENANT, MONITOR_ID));
    const page = await listSummaries(NO_MONITOR_FILTER, FIRST_PAGE, OTHER_TENANT);
    const counts = await unitOfWork.run((tx) => tx.monitorDirectory.healthCounts(OTHER_TENANT));

    expect(summary).toBeNull();
    expect(page).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(counts).toEqual({ up: 0, drift: 0, down: 0, paused: 0, pending: 0, total: 0 });
  });
});

describe('incident directory', () => {
  async function seedIncidentMix(): Promise<void> {
    await seedMonitors(buildMonitor({ name: 'Docs server' }), buildMonitor({ id: 'mon_2', name: 'Search server' }));
    await unitOfWork.run(async (tx) => {
      await tx.drifts.insert(buildDrift({ maxSeverity: 'warning' }));
      const acknowledged = openIncident({ id: 'inc_ack', monitorId: MONITOR_ID, kind: 'drift', lastDriftId: 'drf_1' }, minutesBeforeNow(40));
      await tx.incidents.save(acknowledgeIncident(acknowledged, NOW));
      await tx.incidents.save(openIncident({ id: 'inc_down', monitorId: 'mon_2', kind: 'down', lastDriftId: null }, minutesBeforeNow(30)));
      await tx.incidents.save(openIncident({ id: 'inc_drift', monitorId: 'mon_2', kind: 'drift', lastDriftId: 'drf_1' }, minutesBeforeNow(20)));
      const old = openIncident({ id: 'inc_old', monitorId: MONITOR_ID, kind: 'down', lastDriftId: null }, minutesBeforeNow(60));
      await tx.incidents.save(resolveIncident(old, 'recovered', minutesBeforeNow(50)));
    });
  }

  async function idsAndTotal(filter: Partial<IncidentFilter>): Promise<{ ids: string[]; total: number }> {
    const page = await listIncidents(filter);
    return { ids: page.items.map((view) => view.incident.id), total: page.total };
  }

  it('incident views carry the monitor name and drift severity; filters combine state, kind and acknowledged; counts exclude acknowledged from open', async () => {
    await seedIncidentMix();

    const page = await listIncidents({});
    expect(page.items.map((view) => [view.incident.id, view.monitorName, view.severity])).toEqual([
      ['inc_drift', 'Search server', 'warning'],
      ['inc_down', 'Search server', null],
      ['inc_ack', 'Docs server', 'warning'],
      ['inc_old', 'Docs server', null],
    ]);
    expect(await idsAndTotal({ state: 'open' })).toEqual({ ids: ['inc_drift', 'inc_down', 'inc_ack'], total: 3 });
    expect(await idsAndTotal({ state: 'open', kind: 'drift' })).toEqual({ ids: ['inc_drift', 'inc_ack'], total: 2 });
    expect(await idsAndTotal({ state: 'open', kind: 'drift', acknowledged: false })).toEqual({ ids: ['inc_drift'], total: 1 });
    expect(await idsAndTotal({ acknowledged: true })).toEqual({ ids: ['inc_ack'], total: 1 });
    expect(await idsAndTotal({ state: 'resolved' })).toEqual({ ids: ['inc_old'], total: 1 });

    const counts = await unitOfWork.run((tx) => tx.incidentDirectory.counts(TENANT_ID));
    expect(counts).toEqual({ open: 2, acknowledged: 1, resolved: 1, drift: 2, down: 1 });
  });

  it('pagination with a filter keeps the filter across pages and the total stays the filtered count', async () => {
    await seedIncidentMix();
    const filter = { state: 'open' as const };

    const first = await listIncidents(filter, { cursor: null, limit: 2 });
    const second = await listIncidents(filter, { cursor: first.nextCursor, limit: 2 });

    expect([first, second].map((page) => page.items.map((view) => view.incident.id))).toEqual([['inc_drift', 'inc_down'], ['inc_ack']]);
    expect([first.total, second.total]).toEqual([3, 3]);
  });

  it('tenant isolation: another tenant sees no incidents and zero counts', async () => {
    await seedIncidentMix();

    const page = await listIncidents({}, FIRST_PAGE, OTHER_TENANT);
    const counts = await unitOfWork.run((tx) => tx.incidentDirectory.counts(OTHER_TENANT));

    expect(page).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(counts).toEqual({ open: 0, acknowledged: 0, resolved: 0, drift: 0, down: 0 });
  });
});

describe('totals on the existing listings', () => {
  it('probes and webhook endpoints include the total beyond the page', async () => {
    await seedMonitors(buildMonitor());
    await seedProbes(buildProbe(1), buildProbe(2), buildProbe(3));
    await unitOfWork.run(async (tx) => {
      for (const id of ['whe_1', 'whe_2', 'whe_3']) {
        await tx.webhookEndpoints.save(
          newWebhookEndpoint({ id, tenantId: TENANT_ID, url: `https://hooks.example.com/${id}`, format: 'slack', secretRef: null }, NOW),
        );
      }
    });
    const smallPage = { cursor: null, limit: 2 };

    const probes = await unitOfWork.run((tx) => tx.probes.listForMonitor(MONITOR_ID, smallPage));
    const endpoints = await unitOfWork.run((tx) => tx.webhookEndpoints.listForTenant(TENANT_ID, smallPage));

    expect([probes.items.length, probes.total]).toEqual([2, 3]);
    expect([endpoints.items.length, endpoints.total]).toEqual([2, 3]);
  });
});
