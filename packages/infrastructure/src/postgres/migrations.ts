import { runner } from 'node-pg-migrate';

export interface MigrateConfig {
  databaseUrl: string;
  directory: string;
}

// Returns the names applied. A second instance started during a deploy waits for the lock and then finds nothing to do.
export async function migrate({ databaseUrl, directory }: MigrateConfig): Promise<string[]> {
  const applied = await runner({
    databaseUrl,
    dir: directory,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    advisoryLockMode: 'wait',
  });
  return applied.map((migration) => migration.name);
}
