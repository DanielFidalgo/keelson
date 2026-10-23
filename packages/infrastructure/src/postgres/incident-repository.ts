import type { Incident, IncidentKind, Resolution } from '@keelson/domain';
import type { IncidentRepository, Page, PageRequest } from '@keelson/application';
import { selectPage } from './paging.js';
import { firstOrNull, type Queryable, type RepositoryDeps } from './queryable.js';

interface IncidentRow {
  id: string;
  monitor_id: string;
  kind: IncidentKind;
  state: Incident['state'];
  opened_at: Date;
  resolved_at: Date | null;
  resolution: Resolution | null;
  acknowledged_at: Date | null;
  last_drift_id: string | null;
}

function toIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    kind: row.kind,
    state: row.state,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
    acknowledgedAt: row.acknowledged_at,
    lastDriftId: row.last_drift_id,
  };
}

export class PostgresIncidents implements IncidentRepository {
  private readonly db: Queryable;

  constructor({ db }: RepositoryDeps) {
    this.db = db;
  }

  async findOpen(monitorId: string, kind: IncidentKind): Promise<Incident | null> {
    const { rows } = await this.db.query<IncidentRow>(
      "select * from incidents where monitor_id = $1 and kind = $2 and state = 'open'",
      [monitorId, kind],
    );
    return firstOrNull(rows, toIncident);
  }

  async get(id: string): Promise<Incident | null> {
    const { rows } = await this.db.query<IncidentRow>(
      'select * from incidents where id = $1',
      [id],
    );
    return firstOrNull(rows, toIncident);
  }

  // A second open incident of one kind for a monitor is rejected by the partial unique index, not checked here.
  async save(incident: Incident): Promise<void> {
    await this.db.query(
      `insert into incidents (id, monitor_id, kind, state, opened_at, resolved_at, resolution, acknowledged_at, last_drift_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set
         state = excluded.state,
         resolved_at = excluded.resolved_at,
         resolution = excluded.resolution,
         acknowledged_at = excluded.acknowledged_at,
         last_drift_id = excluded.last_drift_id`,
      [
        incident.id,
        incident.monitorId,
        incident.kind,
        incident.state,
        incident.openedAt,
        incident.resolvedAt,
        incident.resolution,
        incident.acknowledgedAt,
        incident.lastDriftId,
      ],
    );
  }

  listForTenant(
    tenantId: string,
    filter: { state: 'open' | 'resolved' | null },
    page: PageRequest,
  ): Promise<Page<Incident>> {
    const values: unknown[] = [tenantId];
    const conditions = ['m.tenant_id = $1'];
    if (filter.state !== null) {
      values.push(filter.state);
      conditions.push('i.state = $2');
    }
    return selectPage<IncidentRow, Incident>(
      this.db,
      {
        select: 'select i.* from incidents i join monitors m on m.id = i.monitor_id',
        conditions,
        values,
        sortColumn: 'i.opened_at',
        sortType: 'timestamptz',
        idColumn: 'i.id',
        sortKeyOf: (row) => row.opened_at.toISOString(),
      },
      page,
      toIncident,
    );
  }
}
