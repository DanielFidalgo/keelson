import { buildDemoServer } from './server.js';

const DEFAULT_PORT = 3001;
const DEFAULT_DESCRIPTION = 'Returns the weather forecast for a city.';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} must be set`);
  return value;
}

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error('PORT must be a positive integer');

const server = buildDemoServer({
  adminToken: requiredEnv('DEMO_ADMIN_TOKEN'),
  initialDescription: process.env['DEMO_INITIAL_DESCRIPTION'] ?? DEFAULT_DESCRIPTION,
});

// Containers stop with SIGTERM; closing first lets in-flight requests finish.
process.once('SIGTERM', () => void server.close());

await server.listen({ host: '0.0.0.0', port });
