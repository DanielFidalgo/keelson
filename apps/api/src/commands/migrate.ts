import { fileURLToPath } from 'node:url';
import { databaseSchema, migrate, parseConfigSections } from '@keelson/infrastructure';
import { runCommand } from './run-command.js';

// The same relative path works from src/ and from the compiled dist/, which sit side by side.
const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../../../packages/infrastructure/migrations', import.meta.url));

await runCommand(async () => {
  const { database } = parseConfigSections('migrate', process.env, { database: databaseSchema });
  const applied = await migrate({ databaseUrl: database.databaseUrl, directory: MIGRATIONS_DIRECTORY });
  console.log(applied.length === 0 ? 'database is up to date' : `applied: ${applied.join(', ')}`);
});
