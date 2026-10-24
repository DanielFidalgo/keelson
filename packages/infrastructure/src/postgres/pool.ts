import pg from 'pg';
import { writeErrorLog } from '../logging/structured-log.js';

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // The server may drop an idle connection (managed Postgres does); without a listener that event would crash the process.
  pool.on('error', (error) => {
    writeErrorLog('postgres.idle_client_failed', { error: error.message });
  });
  return pool;
}
