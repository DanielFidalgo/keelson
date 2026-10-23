import type { TenantRepository } from '@keelson/application';
import type { Queryable, RepositoryDeps } from './queryable.js';

export class PostgresTenants implements TenantRepository {
  private readonly db: Queryable;

  constructor({ db }: RepositoryDeps) {
    this.db = db;
  }

  async insert(tenant: { id: string; name: string }): Promise<void> {
    await this.db.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name]);
  }
}
