import type { CanonicalCatalog, Snapshot, SnapshotHash } from '@keelson/domain';
import type { SnapshotStore } from '@keelson/application';
import { firstOrNull, type Queryable, type RepositoryDeps } from './queryable.js';

interface SnapshotRow {
  hash: string;
  canonical: CanonicalCatalog;
}

function toSnapshot(row: SnapshotRow): Snapshot {
  return { hash: row.hash as SnapshotHash, catalog: row.canonical };
}

export class PostgresSnapshots implements SnapshotStore {
  private readonly db: Queryable;

  constructor({ db }: RepositoryDeps) {
    this.db = db;
  }

  async saveIfAbsent(snapshot: Snapshot, now: Date): Promise<void> {
    // Serialised by hand: the driver would turn a JavaScript array into a Postgres array, not into jsonb.
    await this.db.query(
      'insert into snapshots (hash, canonical, first_seen_at) values ($1, $2, $3) on conflict (hash) do nothing',
      [snapshot.hash, JSON.stringify(snapshot.catalog), now],
    );
  }

  async get(hash: SnapshotHash): Promise<Snapshot | null> {
    const { rows } = await this.db.query<SnapshotRow>(
      'select hash, canonical from snapshots where hash = $1',
      [hash],
    );
    return firstOrNull(rows, toSnapshot);
  }
}
