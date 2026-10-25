import type { Monitor, SnapshotHash } from '@keelson/domain';
import type { MonitorRepository, Page, PageRequest } from '@keelson/application';
import { selectPage } from './paging.js';
import { firstOrNull, type Queryable, type RepositoryDeps } from './queryable.js';

export interface MonitorRow {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  transport: Monitor['transport'];
  auth_secret_ref: string | null;
  interval_seconds: number;
  next_probe_at: Date;
  baseline_hash: string | null;
  consecutive_failures: number;
  status: Monitor['status'];
  created_at: Date;
}

export function toMonitor(row: MonitorRow): Monitor {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    url: row.url,
    transport: row.transport,
    authSecretRef: row.auth_secret_ref,
    intervalSeconds: row.interval_seconds,
    nextProbeAt: row.next_probe_at,
    baselineHash: row.baseline_hash as SnapshotHash | null,
    consecutiveFailures: row.consecutive_failures,
    status: row.status,
    createdAt: row.created_at,
  };
}

export class PostgresMonitors implements MonitorRepository {
  private readonly db: Queryable;

  constructor({ db }: RepositoryDeps) {
    this.db = db;
  }

  async get(id: string): Promise<Monitor | null> {
    const { rows } = await this.db.query<MonitorRow>(
      'select * from monitors where id = $1',
      [id],
    );
    return firstOrNull(rows, toMonitor);
  }

  async lockForUpdate(id: string): Promise<Monitor | null> {
    const { rows } = await this.db.query<MonitorRow>(
      'select * from monitors where id = $1 for update',
      [id],
    );
    return firstOrNull(rows, toMonitor);
  }

  // Rows another dispatcher has locked are skipped rather than waited for, so two dispatchers never take the same monitor.
  async claimDue(now: Date, limit: number): Promise<Monitor[]> {
    const { rows } = await this.db.query<MonitorRow>(
      `select * from monitors
       where status = 'active' and next_probe_at <= $1
       order by next_probe_at, id
       limit $2
       for update skip locked`,
      [now, limit],
    );
    return rows.map(toMonitor);
  }

  async save(monitor: Monitor): Promise<void> {
    await this.db.query(
      `insert into monitors (id, tenant_id, name, url, transport, auth_secret_ref, interval_seconds,
                             next_probe_at, baseline_hash, consecutive_failures, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (id) do update set
         name = excluded.name,
         url = excluded.url,
         transport = excluded.transport,
         auth_secret_ref = excluded.auth_secret_ref,
         interval_seconds = excluded.interval_seconds,
         next_probe_at = excluded.next_probe_at,
         baseline_hash = excluded.baseline_hash,
         consecutive_failures = excluded.consecutive_failures,
         status = excluded.status`,
      [
        monitor.id,
        monitor.tenantId,
        monitor.name,
        monitor.url,
        monitor.transport,
        monitor.authSecretRef,
        monitor.intervalSeconds,
        monitor.nextProbeAt,
        monitor.baselineHash,
        monitor.consecutiveFailures,
        monitor.status,
        monitor.createdAt,
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.query('delete from monitors where id = $1', [id]);
  }

  listForTenant(tenantId: string, page: PageRequest): Promise<Page<Monitor>> {
    return selectPage<MonitorRow, Monitor>(
      this.db,
      {
        select: 'select * from monitors',
        conditions: ['tenant_id = $1'],
        values: [tenantId],
        sortColumn: 'created_at',
        sortType: 'timestamptz',
        idColumn: 'id',
        sortKeyOf: (row) => row.created_at.toISOString(),
      },
      page,
      toMonitor,
    );
  }
}
