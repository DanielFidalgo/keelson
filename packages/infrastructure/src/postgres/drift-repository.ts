import type { Change, Drift, Severity, SnapshotHash } from '@keelson/domain';
import type { DriftRepository } from '@keelson/application';
import { firstOrNull, type Queryable, type RepositoryDeps } from './queryable.js';

interface DriftRow {
  id: string;
  monitor_id: string;
  from_hash: string;
  to_hash: string;
  changes: Change[];
  max_severity: Severity;
  detected_at: Date;
}

function toDrift(row: DriftRow): Drift {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    fromHash: row.from_hash as SnapshotHash,
    toHash: row.to_hash as SnapshotHash,
    changes: row.changes,
    maxSeverity: row.max_severity,
    detectedAt: row.detected_at,
  };
}

export class PostgresDrifts implements DriftRepository {
  private readonly db: Queryable;

  constructor({ db }: RepositoryDeps) {
    this.db = db;
  }

  async insert(drift: Drift): Promise<void> {
    await this.db.query(
      `insert into drifts (id, monitor_id, from_hash, to_hash, changes, max_severity, detected_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [drift.id, drift.monitorId, drift.fromHash, drift.toHash, JSON.stringify(drift.changes), drift.maxSeverity, drift.detectedAt],
    );
  }

  async get(id: string): Promise<Drift | null> {
    const { rows } = await this.db.query<DriftRow>(
      'select * from drifts where id = $1',
      [id],
    );
    return firstOrNull(rows, toDrift);
  }
}
