import { fileURLToPath } from 'node:url';
import {
  newMonitor,
  newWebhookEndpoint,
  openIncident,
  type Drift,
  type Monitor,
  type Probe,
  type Snapshot,
  type SnapshotHash,
  type WebhookEndpoint,
} from '@keelson/domain';
import type { OutboxMessage } from '@keelson/application';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from './pool.js';
import { migrate } from './migrations.js';
import { PostgresUnitOfWork } from './unit-of-work.js';

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../migrations', import.meta.url));
const NOW = new Date('2026-10-22T12:00:00.000Z');
const TENANT_ID = 'ten_1';
const FIRST_PAGE = { cursor: null, limit: 50 };
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;
const MILLISECONDS_PER_MINUTE = 60_000;

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
  await unitOfWork.run((tx) => tx.tenants.insert({ id: TENANT_ID, name: 'Acme' }));
});

function minutesAfterNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MILLISECONDS_PER_MINUTE);
}

function buildMonitor(overrides: Partial<Monitor> = {}): Monitor {
  const monitor = newMonitor(
    { id: 'mon_1', tenantId: TENANT_ID, name: 'Docs', url: 'https://mcp.example.com/mcp', intervalSeconds: 300, authSecretRef: null },
    NOW,
  );
  return { ...monitor, ...overrides };
}

function buildEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  const endpoint = newWebhookEndpoint(
    { id: 'whe_1', tenantId: TENANT_ID, url: 'https://hooks.example.com/keelson', format: 'standard', secretRef: 'secret/whe_1' },
    NOW,
  );
  return { ...endpoint, ...overrides };
}

function buildSnapshot(hash: string): Snapshot {
  return {
    hash: hash as SnapshotHash,
    catalog: {
      tools: [{ name: 'search', description: 'Searches the docs', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }],
      prompts: [],
      resources: [{ uri: 'file:///readme' }],
    },
  };
}

function buildProbe(overrides: Partial<Probe> = {}): Probe {
  return {
    id: 'prb_1',
    monitorId: 'mon_1',
    slot: 100,
    startedAt: NOW,
    latencyMs: 42,
    outcome: 'up',
    errorDetail: null,
    serverName: 'docs',
    serverVersion: '1.0.0',
    snapshotHash: null,
    ...overrides,
  };
}

function buildDrift(overrides: Partial<Drift> = {}): Drift {
  return {
    id: 'drf_1',
    monitorId: 'mon_1',
    fromHash: 'hash_a' as SnapshotHash,
    toHash: 'hash_b' as SnapshotHash,
    changes: [{ kind: 'description_changed', target: 'tool', name: 'search', before: 'old', after: 'new', severity: 'critical' }],
    maxSeverity: 'critical',
    detectedAt: NOW,
    ...overrides,
  };
}

function buildMessage(overrides: Partial<OutboxMessage> = {}): OutboxMessage {
  return {
    id: 'out_1',
    incidentId: 'inc_1',
    endpointId: 'whe_1',
    alert: {
      type: 'incident.opened',
      incidentId: 'inc_1',
      monitorId: 'mon_1',
      monitorName: 'Docs',
      kind: 'drift',
      severity: 'critical',
      changes: [{ kind: 'tool_added', name: 'extra', severity: 'warning' }],
      resolution: null,
      occurredAt: NOW,
    },
    idempotencyKey: 'msg_1',
    attempts: 0,
    nextAttemptAt: NOW,
    sentAt: null,
    ...overrides,
  };
}

async function seedMonitors(...monitors: Monitor[]): Promise<void> {
  await unitOfWork.run(async (tx) => {
    for (const monitor of monitors) await tx.monitors.save(monitor);
  });
}

async function seedOpenIncident(id = 'inc_1', monitorId = 'mon_1'): Promise<void> {
  await unitOfWork.run((tx) => tx.incidents.save(openIncident({ id, monitorId, kind: 'down', lastDriftId: null }, NOW)));
}

async function countRows(table: string): Promise<number> {
  const result = await pool.query<{ total: number }>(`select count(*)::int as total from ${table}`);
  return result.rows[0]?.total ?? 0;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('migrate', () => {
  it('applies 0001 once; a second run applies nothing', async () => {
    await pool.query('create database migration_check');
    const databaseUrl = new URL(container.getConnectionUri());
    databaseUrl.pathname = '/migration_check';

    const first = await migrate({ databaseUrl: databaseUrl.href, directory: MIGRATIONS_DIRECTORY });
    const second = await migrate({ databaseUrl: databaseUrl.href, directory: MIGRATIONS_DIRECTORY });

    expect(first).toEqual(['0001_initial']);
    expect(second).toEqual([]);
  });
});

describe('schema', () => {
  it('probes.snapshot_hash has no foreign key to snapshots', async () => {
    await seedMonitors(buildMonitor());
    const hash = 'hash_late';

    await unitOfWork.run(async (tx) => {
      await tx.probes.insertIfAbsent(buildProbe({ snapshotHash: hash as SnapshotHash }));
      await tx.snapshots.saveIfAbsent(buildSnapshot(hash), NOW);
    });

    const referencedTables = await pool.query<{ referenced: string }>(
      "select confrelid::regclass::text as referenced from pg_constraint where conrelid = 'probes'::regclass and contype = 'f'",
    );
    expect(referencedTables.rows).toEqual([{ referenced: 'monitors' }]);
    expect(await countRows('probes')).toBe(1);
  });

  it('a second open incident of the same kind for one monitor violates the partial unique index', async () => {
    await seedMonitors(buildMonitor());
    await seedOpenIncident('inc_1');

    const second = unitOfWork.run((tx) => tx.incidents.save(openIncident({ id: 'inc_2', monitorId: 'mon_1', kind: 'down', lastDriftId: null }, NOW)));

    await expect(second).rejects.toMatchObject({ code: '23505' });
  });

  it('deleting a monitor removes its probes, drifts, incidents and their outbox messages', async () => {
    await seedMonitors(buildMonitor());
    await unitOfWork.run(async (tx) => {
      await tx.webhookEndpoints.save(buildEndpoint());
      await tx.probes.insertIfAbsent(buildProbe());
      await tx.drifts.insert(buildDrift());
      await tx.incidents.save(openIncident({ id: 'inc_1', monitorId: 'mon_1', kind: 'drift', lastDriftId: 'drf_1' }, NOW));
      await tx.outbox.enqueue([buildMessage()]);
    });

    await unitOfWork.run((tx) => tx.monitors.delete('mon_1'));

    const remaining = await Promise.all(['probes', 'drifts', 'incidents', 'outbox'].map(countRows));
    expect(remaining).toEqual([0, 0, 0, 0]);
  });
});

describe('unit of work', () => {
  it('a failure inside run rolls back every write', async () => {
    const failing = unitOfWork.run(async (tx) => {
      await tx.tenants.insert({ id: 'ten_rolled_back', name: 'Gone' });
      await tx.monitors.save(buildMonitor({ tenantId: 'ten_rolled_back' }));
      throw new Error('boom');
    });

    await expect(failing).rejects.toThrow('boom');
    expect(await countRows("tenants where id = 'ten_rolled_back'")).toBe(0);
    expect(await countRows('monitors')).toBe(0);
  });

  it('commits the writes of a run that returns, and returns its result', async () => {
    const result = await unitOfWork.run(async (tx) => {
      await tx.monitors.save(buildMonitor());
      return 'done';
    });

    expect(result).toBe('done');
    expect(await countRows('monitors')).toBe(1);
  });
});

describe('monitors', () => {
  it('saves a monitor, reads it back and updates it in place', async () => {
    await seedMonitors(buildMonitor());
    await seedMonitors(buildMonitor({ name: 'Renamed', consecutiveFailures: 2, baselineHash: 'hash_a' as SnapshotHash }));

    const stored = await unitOfWork.run((tx) => tx.monitors.get('mon_1'));

    expect(stored).toEqual(buildMonitor({ name: 'Renamed', consecutiveFailures: 2, baselineHash: 'hash_a' as SnapshotHash }));
    expect(await countRows('monitors')).toBe(1);
  });

  it('returns null for a monitor that does not exist', async () => {
    expect(await unitOfWork.run((tx) => tx.monitors.get('mon_missing'))).toBeNull();
  });

  it('claimDue returns only active monitors that are due, earliest first, up to the limit', async () => {
    await seedMonitors(
      buildMonitor({ id: 'mon_late', nextProbeAt: minutesAfterNow(-1) }),
      buildMonitor({ id: 'mon_early', nextProbeAt: minutesAfterNow(-10) }),
      buildMonitor({ id: 'mon_future', nextProbeAt: minutesAfterNow(5) }),
      buildMonitor({ id: 'mon_paused', nextProbeAt: minutesAfterNow(-10), status: 'paused' }),
    );

    const claimed = await unitOfWork.run((tx) => tx.monitors.claimDue(NOW, 2));

    expect(claimed.map((monitor) => monitor.id)).toEqual(['mon_early', 'mon_late']);
  });

  it('claimDue skips rows locked by a concurrent transaction', async () => {
    await seedMonitors(
      buildMonitor({ id: 'mon_a', nextProbeAt: minutesAfterNow(-10) }),
      buildMonitor({ id: 'mon_b', nextProbeAt: minutesAfterNow(-5) }),
    );
    const firstHasClaimed = deferred<string[]>();
    const releaseFirst = deferred<undefined>();
    const first = unitOfWork.run(async (tx) => {
      const claimed = await tx.monitors.claimDue(NOW, 1);
      firstHasClaimed.resolve(claimed.map((monitor) => monitor.id));
      await releaseFirst.promise;
    });

    const claimedByFirst = await firstHasClaimed.promise;
    const claimedBySecond = await unitOfWork.run((tx) => tx.monitors.claimDue(NOW, 1));
    releaseFirst.resolve(undefined);
    await first;

    expect(claimedByFirst).toEqual(['mon_a']);
    expect(claimedBySecond.map((monitor) => monitor.id)).toEqual(['mon_b']);
  });

  it('listForTenant pages with an opaque cursor and returns nextCursor null on the last page', async () => {
    await seedMonitors(
      buildMonitor({ id: 'mon_1', createdAt: minutesAfterNow(1) }),
      buildMonitor({ id: 'mon_2', createdAt: minutesAfterNow(2) }),
      buildMonitor({ id: 'mon_3', createdAt: minutesAfterNow(3) }),
      buildMonitor({ id: 'mon_4', createdAt: minutesAfterNow(3) }),
      buildMonitor({ id: 'mon_5', createdAt: minutesAfterNow(4) }),
    );

    const first = await unitOfWork.run((tx) => tx.monitors.listForTenant(TENANT_ID, { cursor: null, limit: 2 }));
    const second = await unitOfWork.run((tx) => tx.monitors.listForTenant(TENANT_ID, { cursor: first.nextCursor, limit: 2 }));
    const third = await unitOfWork.run((tx) => tx.monitors.listForTenant(TENANT_ID, { cursor: second.nextCursor, limit: 2 }));

    expect(first.items.map((monitor) => monitor.id)).toEqual(['mon_5', 'mon_4']);
    expect(second.items.map((monitor) => monitor.id)).toEqual(['mon_3', 'mon_2']);
    expect(third.items.map((monitor) => monitor.id)).toEqual(['mon_1']);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(third.nextCursor).toBeNull();
  });

  it('listForTenant returns an empty page for a cursor it did not issue', async () => {
    await seedMonitors(buildMonitor());

    const page = await unitOfWork.run((tx) => tx.monitors.listForTenant(TENANT_ID, { cursor: 'not-a-cursor', limit: 10 }));

    expect(page).toEqual({ items: [], nextCursor: null });
  });
});

describe('probes', () => {
  beforeEach(() => seedMonitors(buildMonitor()));

  it('insertIfAbsent returns false for a duplicate (monitor_id, slot)', async () => {
    const inserted = await unitOfWork.run((tx) => tx.probes.insertIfAbsent(buildProbe({ id: 'prb_1' })));
    const duplicate = await unitOfWork.run((tx) => tx.probes.insertIfAbsent(buildProbe({ id: 'prb_2' })));

    expect([inserted, duplicate]).toEqual([true, false]);
    expect(await countRows('probes')).toBe(1);
  });

  it('latestUp returns the newest up probe and ignores failures', async () => {
    await unitOfWork.run(async (tx) => {
      await tx.probes.insertIfAbsent(buildProbe({ id: 'prb_1', slot: 1, startedAt: minutesAfterNow(1), outcome: 'up' }));
      await tx.probes.insertIfAbsent(buildProbe({ id: 'prb_2', slot: 2, startedAt: minutesAfterNow(2), outcome: 'up', serverVersion: '2.0.0' }));
      await tx.probes.insertIfAbsent(buildProbe({ id: 'prb_3', slot: 3, startedAt: minutesAfterNow(3), outcome: 'timeout', errorDetail: 'slow', serverName: null, serverVersion: null }));
    });

    const latest = await unitOfWork.run((tx) => tx.probes.latestUp('mon_1'));

    expect(latest).toEqual(buildProbe({ id: 'prb_2', slot: 2, startedAt: minutesAfterNow(2), serverVersion: '2.0.0' }));
  });

  it('listForMonitor returns the most recently started probe first and pages through the rest', async () => {
    await unitOfWork.run(async (tx) => {
      for (const slot of [1, 2, 3]) {
        await tx.probes.insertIfAbsent(buildProbe({ id: `prb_${String(slot)}`, slot, startedAt: minutesAfterNow(slot) }));
      }
    });

    const first = await unitOfWork.run((tx) => tx.probes.listForMonitor('mon_1', { cursor: null, limit: 2 }));
    const second = await unitOfWork.run((tx) => tx.probes.listForMonitor('mon_1', { cursor: first.nextCursor, limit: 2 }));

    expect(first.items.map((probe) => probe.slot)).toEqual([3, 2]);
    expect(second.items.map((probe) => probe.slot)).toEqual([1]);
    expect(second.nextCursor).toBeNull();
  });

  it('latestUp and listForMonitor order by start time across an interval change', async () => {
    // After a 300 s to 600 s change the new slots are about half the old ones, so a larger slot is the older probe.
    await unitOfWork.run(async (tx) => {
      await tx.probes.insertIfAbsent(buildProbe({ id: 'prb_old_interval', slot: 100, startedAt: NOW }));
      await tx.probes.insertIfAbsent(buildProbe({ id: 'prb_new_interval', slot: 50, startedAt: minutesAfterNow(10) }));
    });

    const latest = await unitOfWork.run((tx) => tx.probes.latestUp('mon_1'));
    const page = await unitOfWork.run((tx) => tx.probes.listForMonitor('mon_1', FIRST_PAGE));

    expect(latest?.id).toBe('prb_new_interval');
    expect(page.items.map((probe) => probe.id)).toEqual(['prb_new_interval', 'prb_old_interval']);
  });

  it('monitorHasSnapshot is true only for a hash the monitor served', async () => {
    await unitOfWork.run((tx) => tx.probes.insertIfAbsent(buildProbe({ snapshotHash: 'hash_a' as SnapshotHash })));

    const [served, unserved] = await unitOfWork.run(async (tx) => [
      await tx.probes.monitorHasSnapshot('mon_1', 'hash_a' as SnapshotHash),
      await tx.probes.monitorHasSnapshot('mon_1', 'hash_b' as SnapshotHash),
    ]);

    expect([served, unserved]).toEqual([true, false]);
  });
});

describe('snapshots', () => {
  it('snapshot saveIfAbsent stores one row per hash', async () => {
    const snapshot = buildSnapshot('hash_a');

    await unitOfWork.run((tx) => tx.snapshots.saveIfAbsent(snapshot, NOW));
    await unitOfWork.run((tx) => tx.snapshots.saveIfAbsent(snapshot, minutesAfterNow(5)));

    expect(await countRows('snapshots')).toBe(1);
    expect(await unitOfWork.run((tx) => tx.snapshots.get(snapshot.hash))).toEqual(snapshot);
  });

  it('returns null for an unknown hash', async () => {
    expect(await unitOfWork.run((tx) => tx.snapshots.get('hash_missing' as SnapshotHash))).toBeNull();
  });
});

describe('drifts', () => {
  it('stores a drift with its changes and reads it back', async () => {
    await seedMonitors(buildMonitor());
    const drift = buildDrift();

    await unitOfWork.run((tx) => tx.drifts.insert(drift));

    expect(await unitOfWork.run((tx) => tx.drifts.get('drf_1'))).toEqual(drift);
  });
});

describe('incidents', () => {
  beforeEach(() => seedMonitors(buildMonitor()));

  it('findOpen returns the open incident of a kind and nothing once it is resolved', async () => {
    const opened = openIncident({ id: 'inc_1', monitorId: 'mon_1', kind: 'down', lastDriftId: null }, NOW);
    await unitOfWork.run((tx) => tx.incidents.save(opened));
    const whileOpen = await unitOfWork.run((tx) => tx.incidents.findOpen('mon_1', 'down'));

    await unitOfWork.run((tx) => tx.incidents.save({ ...opened, state: 'resolved', resolvedAt: minutesAfterNow(9), resolution: 'recovered' }));
    const afterResolve = await unitOfWork.run((tx) => tx.incidents.findOpen('mon_1', 'down'));

    expect(whileOpen).toEqual(opened);
    expect(afterResolve).toBeNull();
  });

  it('a resolved incident does not block opening a new one of the same kind', async () => {
    const opened = openIncident({ id: 'inc_1', monitorId: 'mon_1', kind: 'down', lastDriftId: null }, NOW);
    await unitOfWork.run((tx) => tx.incidents.save({ ...opened, state: 'resolved', resolvedAt: NOW, resolution: 'recovered' }));

    await unitOfWork.run((tx) => tx.incidents.save(openIncident({ id: 'inc_2', monitorId: 'mon_1', kind: 'down', lastDriftId: null }, NOW)));

    expect(await countRows('incidents')).toBe(2);
  });

  it('listForTenant filters by state and ignores other tenants', async () => {
    await unitOfWork.run(async (tx) => {
      await tx.tenants.insert({ id: 'ten_other', name: 'Other' });
      await tx.monitors.save(buildMonitor({ id: 'mon_other', tenantId: 'ten_other' }));
      const open = openIncident({ id: 'inc_open', monitorId: 'mon_1', kind: 'down', lastDriftId: null }, minutesAfterNow(2));
      const resolved = { ...openIncident({ id: 'inc_resolved', monitorId: 'mon_1', kind: 'drift', lastDriftId: null }, NOW), state: 'resolved' as const, resolvedAt: NOW, resolution: 'approved' as const };
      await tx.incidents.save(open);
      await tx.incidents.save(resolved);
      await tx.incidents.save(openIncident({ id: 'inc_foreign', monitorId: 'mon_other', kind: 'down', lastDriftId: null }, NOW));
    });

    const everything = await unitOfWork.run((tx) => tx.incidents.listForTenant(TENANT_ID, { state: null }, FIRST_PAGE));
    const onlyOpen = await unitOfWork.run((tx) => tx.incidents.listForTenant(TENANT_ID, { state: 'open' }, FIRST_PAGE));

    expect(everything.items.map((incident) => incident.id)).toEqual(['inc_open', 'inc_resolved']);
    expect(onlyOpen.items.map((incident) => incident.id)).toEqual(['inc_open']);
  });
});

describe('webhook endpoints', () => {
  it('saves, updates, lists active ones and deletes', async () => {
    await unitOfWork.run(async (tx) => {
      await tx.webhookEndpoints.save(buildEndpoint({ id: 'whe_1' }));
      await tx.webhookEndpoints.save(buildEndpoint({ id: 'whe_2', format: 'slack', secretRef: null }));
      await tx.webhookEndpoints.save(buildEndpoint({ id: 'whe_2', format: 'slack', secretRef: null, status: 'disabled', consecutiveFailures: 10 }));
    });

    const active = await unitOfWork.run((tx) => tx.webhookEndpoints.listActive(TENANT_ID));
    const disabled = await unitOfWork.run((tx) => tx.webhookEndpoints.get('whe_2'));
    await unitOfWork.run((tx) => tx.webhookEndpoints.delete('whe_1'));

    expect(active).toEqual([buildEndpoint({ id: 'whe_1' })]);
    expect(disabled).toEqual(buildEndpoint({ id: 'whe_2', format: 'slack', secretRef: null, status: 'disabled', consecutiveFailures: 10 }));
    expect(await countRows('webhook_endpoints')).toBe(1);
  });

  it('listForTenant pages newest first', async () => {
    await unitOfWork.run(async (tx) => {
      await tx.webhookEndpoints.save(buildEndpoint({ id: 'whe_1', createdAt: minutesAfterNow(1) }));
      await tx.webhookEndpoints.save(buildEndpoint({ id: 'whe_2', createdAt: minutesAfterNow(2) }));
    });

    const first = await unitOfWork.run((tx) => tx.webhookEndpoints.listForTenant(TENANT_ID, { cursor: null, limit: 1 }));
    const second = await unitOfWork.run((tx) => tx.webhookEndpoints.listForTenant(TENANT_ID, { cursor: first.nextCursor, limit: 1 }));

    expect(first.items.map((endpoint) => endpoint.id)).toEqual(['whe_2']);
    expect(second.items.map((endpoint) => endpoint.id)).toEqual(['whe_1']);
    expect(second.nextCursor).toBeNull();
  });
});

describe('outbox', () => {
  beforeEach(async () => {
    await seedMonitors(buildMonitor());
    await seedOpenIncident();
    await unitOfWork.run(async (tx) => {
      await tx.webhookEndpoints.save(buildEndpoint({ id: 'whe_1' }));
      await tx.webhookEndpoints.save(buildEndpoint({ id: 'whe_off', status: 'disabled' }));
    });
  });

  it('outbox claimDue returns only unsent, due messages of active endpoints and moves nextAttemptAt to the lease', async () => {
    const lease = minutesAfterNow(5);
    await unitOfWork.run((tx) =>
      tx.outbox.enqueue([
        buildMessage({ id: 'out_due', idempotencyKey: 'msg_due' }),
        buildMessage({ id: 'out_future', idempotencyKey: 'msg_future', nextAttemptAt: minutesAfterNow(1) }),
        buildMessage({ id: 'out_sent', idempotencyKey: 'msg_sent', sentAt: NOW }),
        buildMessage({ id: 'out_disabled', idempotencyKey: 'msg_disabled', endpointId: 'whe_off' }),
      ]),
    );

    const claimed = await unitOfWork.run((tx) => tx.outbox.claimDue(NOW, lease, 10));
    const claimedAgain = await unitOfWork.run((tx) => tx.outbox.claimDue(NOW, lease, 10));

    expect(claimed).toEqual([buildMessage({ id: 'out_due', idempotencyKey: 'msg_due', nextAttemptAt: lease })]);
    expect(claimedAgain).toEqual([]);
  });

  it('claimDue honours the limit', async () => {
    await unitOfWork.run((tx) =>
      tx.outbox.enqueue([buildMessage({ id: 'out_1', idempotencyKey: 'msg_1' }), buildMessage({ id: 'out_2', idempotencyKey: 'msg_2' })]),
    );

    const claimed = await unitOfWork.run((tx) => tx.outbox.claimDue(NOW, minutesAfterNow(5), 1));

    expect(claimed).toHaveLength(1);
  });

  it('markSent records when the message was sent, and a sent message is never due again', async () => {
    await unitOfWork.run((tx) => tx.outbox.enqueue([buildMessage()]));

    await unitOfWork.run((tx) => tx.outbox.markSent('out_1', minutesAfterNow(1)));

    expect(await unitOfWork.run((tx) => tx.outbox.claimDue(minutesAfterNow(60), minutesAfterNow(65), 10))).toEqual([]);
  });

  it('markFailed records the attempts and the next attempt time', async () => {
    await unitOfWork.run((tx) => tx.outbox.enqueue([buildMessage()]));
    const retryAt = minutesAfterNow(2);

    await unitOfWork.run((tx) => tx.outbox.markFailed('out_1', 1, retryAt));

    const claimed = await unitOfWork.run((tx) => tx.outbox.claimDue(retryAt, minutesAfterNow(7), 10));
    expect(claimed.map((message) => [message.id, message.attempts])).toEqual([['out_1', 1]]);
  });

  it('rejects marking a message that does not exist', async () => {
    await expect(unitOfWork.run((tx) => tx.outbox.markSent('out_missing', NOW))).rejects.toThrow('unknown outbox message: out_missing');
  });
});

describe('api keys', () => {
  it('finds the tenant that owns a key hash and nothing for an unknown hash', async () => {
    await unitOfWork.run((tx) => tx.apiKeys.insert({ id: 'key_1', tenantId: TENANT_ID, keyHash: 'hash_of_key', createdAt: NOW }));

    expect(await unitOfWork.run((tx) => tx.apiKeys.findTenantIdByHash('hash_of_key'))).toBe(TENANT_ID);
    expect(await unitOfWork.run((tx) => tx.apiKeys.findTenantIdByHash('hash_unknown'))).toBeNull();
  });

  it('rejects a second key with the same hash', async () => {
    await unitOfWork.run((tx) => tx.apiKeys.insert({ id: 'key_1', tenantId: TENANT_ID, keyHash: 'hash_of_key', createdAt: NOW }));

    const duplicate = unitOfWork.run((tx) => tx.apiKeys.insert({ id: 'key_2', tenantId: TENANT_ID, keyHash: 'hash_of_key', createdAt: NOW }));

    await expect(duplicate).rejects.toMatchObject({ code: '23505' });
  });

  it('does not authenticate a revoked key', async () => {
    await unitOfWork.run((tx) => tx.apiKeys.insert({ id: 'key_1', tenantId: TENANT_ID, keyHash: 'hash_of_key', createdAt: NOW }));
    await pool.query("update api_keys set revoked_at = now() where id = 'key_1'");

    expect(await unitOfWork.run((tx) => tx.apiKeys.findTenantIdByHash('hash_of_key'))).toBeNull();
  });
});
