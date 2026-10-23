import type { ApiKeyRepository } from '@keelson/application';
import type { Queryable, RepositoryDeps } from './queryable.js';

export class PostgresApiKeys implements ApiKeyRepository {
  private readonly db: Queryable;

  constructor({ db }: RepositoryDeps) {
    this.db = db;
  }

  async insert(key: { id: string; tenantId: string; keyHash: string; createdAt: Date }): Promise<void> {
    await this.db.query('insert into api_keys (id, tenant_id, key_hash, created_at) values ($1, $2, $3, $4)', [
      key.id,
      key.tenantId,
      key.keyHash,
      key.createdAt,
    ]);
  }

  // A revoked key stops authenticating but its row stays, so the audit trail of who held access survives.
  async findTenantIdByHash(keyHash: string): Promise<string | null> {
    const { rows } = await this.db.query<{ tenant_id: string }>(
      'select tenant_id from api_keys where key_hash = $1 and revoked_at is null',
      [keyHash],
    );
    return rows[0]?.tenant_id ?? null;
  }
}
