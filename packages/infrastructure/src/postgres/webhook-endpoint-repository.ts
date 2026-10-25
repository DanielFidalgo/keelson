import type { WebhookEndpoint } from '@keelson/domain';
import type { CountedPage, PageRequest, WebhookEndpointRepository } from '@keelson/application';
import { selectCountedPage } from './paging.js';
import { firstOrNull, type Queryable, type RepositoryDeps } from './queryable.js';

interface WebhookEndpointRow {
  id: string;
  tenant_id: string;
  url: string;
  format: WebhookEndpoint['format'];
  secret_ref: string | null;
  status: WebhookEndpoint['status'];
  consecutive_failures: number;
  created_at: Date;
}

function toWebhookEndpoint(row: WebhookEndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    url: row.url,
    format: row.format,
    secretRef: row.secret_ref,
    status: row.status,
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at,
  };
}

export class PostgresWebhookEndpoints implements WebhookEndpointRepository {
  private readonly db: Queryable;

  constructor({ db }: RepositoryDeps) {
    this.db = db;
  }

  async get(id: string): Promise<WebhookEndpoint | null> {
    const { rows } = await this.db.query<WebhookEndpointRow>(
      'select * from webhook_endpoints where id = $1',
      [id],
    );
    return firstOrNull(rows, toWebhookEndpoint);
  }

  async save(endpoint: WebhookEndpoint): Promise<void> {
    await this.db.query(
      `insert into webhook_endpoints (id, tenant_id, url, format, secret_ref, status, consecutive_failures, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set
         url = excluded.url,
         format = excluded.format,
         secret_ref = excluded.secret_ref,
         status = excluded.status,
         consecutive_failures = excluded.consecutive_failures`,
      [
        endpoint.id,
        endpoint.tenantId,
        endpoint.url,
        endpoint.format,
        endpoint.secretRef,
        endpoint.status,
        endpoint.consecutiveFailures,
        endpoint.createdAt,
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.query('delete from webhook_endpoints where id = $1', [id]);
  }

  async listActive(tenantId: string): Promise<WebhookEndpoint[]> {
    const { rows } = await this.db.query<WebhookEndpointRow>(
      "select * from webhook_endpoints where tenant_id = $1 and status = 'active' order by created_at desc, id desc",
      [tenantId],
    );
    return rows.map(toWebhookEndpoint);
  }

  listForTenant(tenantId: string, page: PageRequest): Promise<CountedPage<WebhookEndpoint>> {
    return selectCountedPage<WebhookEndpointRow, WebhookEndpoint>(
      this.db,
      {
        select: 'select * from webhook_endpoints',
        conditions: ['tenant_id = $1'],
        values: [tenantId],
        sortColumn: 'created_at',
        sortType: 'timestamptz',
        idColumn: 'id',
        sortKeyOf: (row) => row.created_at.toISOString(),
      },
      page,
      toWebhookEndpoint,
    );
  }
}
