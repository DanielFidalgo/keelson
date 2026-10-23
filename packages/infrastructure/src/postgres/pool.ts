import pg from 'pg';

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // The server may drop an idle connection (managed Postgres does); without a listener that event would crash the process.
  pool.on('error', (error) => {
    console.error(JSON.stringify({ level: 'error', message: 'idle postgres client failed', error: error.message }));
  });
  return pool;
}
