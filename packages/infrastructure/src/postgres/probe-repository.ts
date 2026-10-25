import type { Probe, SnapshotHash } from '@keelson/domain';
import type { CountedPage, PageRequest, ProbeRepository } from '@keelson/application';
import { selectCountedPage } from './paging.js';
import { firstOrNull, type Queryable, type RepositoryDeps } from './queryable.js';

interface ProbeRow {
  id: string;
  monitor_id: string;
  slot: number;
  started_at: Date;
  latency_ms: number;
  outcome: Probe['outcome'];
  error_detail: string | null;
  server_name: string | null;
  server_version: string | null;
  snapshot_hash: string | null;
}

function toProbe(row: ProbeRow): Probe {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    slot: row.slot,
    startedAt: row.started_at,
    latencyMs: row.latency_ms,
    outcome: row.outcome,
    errorDetail: row.error_detail,
    serverName: row.server_name,
    serverVersion: row.server_version,
    snapshotHash: row.snapshot_hash as SnapshotHash | null,
  };
}

export class PostgresProbes implements ProbeRepository {
  private readonly db: Queryable;

  constructor({ db }: RepositoryDeps) {
    this.db = db;
  }

  // The unique (monitor_id, slot) makes a retried job a no-op instead of a second probe.
  async insertIfAbsent(probe: Probe): Promise<boolean> {
    const result = await this.db.query(
      `insert into probes (id, monitor_id, slot, started_at, latency_ms, outcome, error_detail,
                           server_name, server_version, snapshot_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (monitor_id, slot) do nothing`,
      [
        probe.id,
        probe.monitorId,
        probe.slot,
        probe.startedAt,
        probe.latencyMs,
        probe.outcome,
        probe.errorDetail,
        probe.serverName,
        probe.serverVersion,
        probe.snapshotHash,
      ],
    );
    return result.rowCount === 1;
  }

  async latestUp(monitorId: string): Promise<Probe | null> {
    const { rows } = await this.db.query<ProbeRow>(
      "select * from probes where monitor_id = $1 and outcome = 'up' order by started_at desc, id desc limit 1",
      [monitorId],
    );
    return firstOrNull(rows, toProbe);
  }

  listForMonitor(monitorId: string, page: PageRequest): Promise<CountedPage<Probe>> {
    return selectCountedPage<ProbeRow, Probe>(
      this.db,
      {
        select: 'select * from probes',
        conditions: ['monitor_id = $1'],
        values: [monitorId],
        sortColumn: 'started_at',
        sortType: 'timestamptz',
        idColumn: 'id',
        sortKeyOf: (row) => row.started_at.toISOString(),
      },
      page,
      toProbe,
    );
  }

  async monitorHasSnapshot(monitorId: string, hash: SnapshotHash): Promise<boolean> {
    const { rows } = await this.db.query<{ served: boolean }>(
      'select exists (select 1 from probes where monitor_id = $1 and snapshot_hash = $2) as served',
      [monitorId, hash],
    );
    return rows[0]?.served ?? false;
  }
}
