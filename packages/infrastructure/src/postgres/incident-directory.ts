import type { Severity } from '@keelson/domain';
import type {
  CountedPage,
  IncidentCounts,
  IncidentDirectory,
  IncidentFilter,
  IncidentView,
  PageRequest,
} from '@keelson/application';
import { toIncident, type IncidentRow } from './incident-repository.js';
import { selectCountedPage } from './paging.js';
import type { Queryable, RepositoryDeps } from './queryable.js';

const INCIDENTS_OF_TENANT = `from incidents i join monitors m on m.id = i.monitor_id`;

interface IncidentViewRow extends IncidentRow {
  monitor_name: string;
  severity: Severity | null;
}

function toIncidentView(row: IncidentViewRow): IncidentView {
  return { incident: toIncident(row), monitorName: row.monitor_name, severity: row.severity };
}

// Only a drift carries a severity, so a down incident's join finds no drift and reads as null.
const VIEW_SELECT = `select i.*, m.name as monitor_name, d.max_severity as severity
  ${INCIDENTS_OF_TENANT} left join drifts d on d.id = i.last_drift_id`;

export class PostgresIncidentDirectory implements IncidentDirectory {
  private readonly db: Queryable;

  constructor({ db }: RepositoryDeps) {
    this.db = db;
  }

  list(tenantId: string, filter: IncidentFilter, page: PageRequest): Promise<CountedPage<IncidentView>> {
    const values: unknown[] = [tenantId];
    const conditions = ['m.tenant_id = $1'];
    if (filter.state !== null) {
      values.push(filter.state);
      conditions.push(`i.state = $${String(values.length)}`);
    }
    if (filter.kind !== null) {
      values.push(filter.kind);
      conditions.push(`i.kind = $${String(values.length)}`);
    }
    if (filter.acknowledged !== null) {
      conditions.push(filter.acknowledged ? 'i.acknowledged_at is not null' : 'i.acknowledged_at is null');
    }
    return selectCountedPage<IncidentViewRow, IncidentView>(
      this.db,
      {
        select: VIEW_SELECT,
        countSelect: `select i.id ${INCIDENTS_OF_TENANT}`,
        conditions,
        values,
        sortColumn: 'i.opened_at',
        sortType: 'timestamptz',
        idColumn: 'i.id',
        sortKeyOf: (row) => row.opened_at.toISOString(),
      },
      page,
      toIncidentView,
    );
  }

  async counts(tenantId: string): Promise<IncidentCounts> {
    const { rows } = await this.db.query<IncidentCounts>(
      `select
         (count(*) filter (where i.state = 'open' and i.acknowledged_at is null))::int as open,
         (count(*) filter (where i.state = 'open' and i.acknowledged_at is not null))::int as acknowledged,
         (count(*) filter (where i.state = 'resolved'))::int as resolved,
         (count(*) filter (where i.state = 'open' and i.kind = 'drift'))::int as drift,
         (count(*) filter (where i.state = 'open' and i.kind = 'down'))::int as down
       ${INCIDENTS_OF_TENANT} where m.tenant_id = $1`,
      [tenantId],
    );
    return rows[0] ?? { open: 0, acknowledged: 0, resolved: 0, drift: 0, down: 0 };
  }
}
