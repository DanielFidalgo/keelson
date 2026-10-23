import { parseArgs } from 'node:util';

const USAGE = 'usage: create-tenant --name <name>';

// parseArgs rejects options it does not know, so a mistyped flag fails here rather than being silently ignored.
export function parseTenantName(argv: string[]): string {
  const { values } = parseArgs({ args: argv, options: { name: { type: 'string' } }, strict: true });
  const name = values.name?.trim() ?? '';
  if (name === '') throw new Error(`--name must not be empty. ${USAGE}`);
  return name;
}
