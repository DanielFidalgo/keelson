import type { Transaction, UnitOfWork } from '@keelson/application';
import type { Pool } from 'pg';
import { PostgresApiKeys } from './api-key-repository.js';
import { PostgresDrifts } from './drift-repository.js';
import { PostgresIncidents } from './incident-repository.js';
import { PostgresMonitors } from './monitor-repository.js';
import { PostgresOutbox } from './outbox.js';
import { PostgresProbes } from './probe-repository.js';
import type { Queryable } from './queryable.js';
import { PostgresSnapshots } from './snapshot-store.js';
import { PostgresTenants } from './tenant-repository.js';
import { PostgresWebhookEndpoints } from './webhook-endpoint-repository.js';

export interface PostgresUnitOfWorkDeps {
  pool: Pool;
}

export function createTransaction(db: Queryable): Transaction {
  return {
    monitors: new PostgresMonitors({ db }),
    probes: new PostgresProbes({ db }),
    snapshots: new PostgresSnapshots({ db }),
    drifts: new PostgresDrifts({ db }),
    incidents: new PostgresIncidents({ db }),
    webhookEndpoints: new PostgresWebhookEndpoints({ db }),
    outbox: new PostgresOutbox({ db }),
    tenants: new PostgresTenants({ db }),
    apiKeys: new PostgresApiKeys({ db }),
  };
}

export class PostgresUnitOfWork implements UnitOfWork {
  private readonly pool: Pool;

  constructor({ pool }: PostgresUnitOfWorkDeps) {
    this.pool = pool;
  }

  // One client for the whole call, so every repository in the work shares a single transaction.
  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard: Error | undefined;
    try {
      await client.query('BEGIN');
      const result = await work(createTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      discard = await rollBack(client);
      throw error;
    } finally {
      client.release(discard);
    }
  }
}

// If the rollback itself fails the connection is in an unknown state, so it is handed back to be destroyed
// rather than reused; the caller still sees the error that made the work fail.
async function rollBack(client: Queryable): Promise<Error | undefined> {
  try {
    await client.query('ROLLBACK');
    return undefined;
  } catch (rollbackError) {
    return rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
  }
}
