import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiContainer, loadApiConfig, buildApiServer } from '@keelson/api';
import { buildDemoServer } from '@keelson/demo-server';
import { createLoggerOptions, createPool, migrate } from '@keelson/infrastructure';
import { buildWorkerServer, createWorkerContainer, loadWorkerConfig } from '@keelson/worker';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { asValue } from 'awilix';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { ControllableClock } from './controllable-clock.js';

export const INTERNAL_TOKEN = 'e2e-internal-token';
export const DEMO_ADMIN_TOKEN = 'e2e-demo-admin-token';
export const STACK_STARTUP_TIMEOUT_MS = 120_000;

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../packages/infrastructure/migrations', import.meta.url));
const LOOPBACK = '127.0.0.1';
const EPHEMERAL_PORT = 0;
// The config requires a positive PORT, but the stack listens on ephemeral ports itself, so this value is never bound.
const UNUSED_CONFIGURED_PORT = '1';
const INITIAL_TOOL_DESCRIPTION = 'Returns the weather forecast for a city.';

export interface KeelsonStack {
  apiUrl: string;
  workerUrl: string;
  demoServerUrl: string;
  clock: ControllableClock;
  pool: Pool;
  createTenant: (name: string) => Promise<{ tenantId: string; apiKey: string }>;
  stop: () => Promise<void>;
}

const silentLogging = () => ({ ...createLoggerOptions(), level: 'silent' });

// Everything runs in this process, on ephemeral ports, against a real Postgres, so the only fakes are time and the receiver.
export async function startKeelsonStack(start: Date): Promise<KeelsonStack> {
  const postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
  const databaseUrl = postgres.getConnectionUri();
  await migrate({ databaseUrl, directory: MIGRATIONS_DIRECTORY });
  const pool = createPool(databaseUrl);
  const secretsDirectory = await mkdtemp(join(tmpdir(), 'keelson-e2e-secrets-'));
  const clock = new ControllableClock(start);

  const demoServer = buildDemoServer({ adminToken: DEMO_ADMIN_TOKEN, initialDescription: INITIAL_TOOL_DESCRIPTION });
  const demoServerUrl = await demoServer.listen({ host: LOOPBACK, port: EPHEMERAL_PORT });

  const sharedEnvironment = {
    DATABASE_URL: databaseUrl,
    PORT: UNUSED_CONFIGURED_PORT,
    INTERNAL_AUTH_MODE: 'static',
    INTERNAL_STATIC_TOKEN: INTERNAL_TOKEN,
    SECRET_STORE: 'file',
    SECRETS_DIR: secretsDirectory,
  };

  const workerContainer = createWorkerContainer(
    loadWorkerConfig({ ...sharedEnvironment, ALLOW_PRIVATE_TARGETS: 'true', ALLOW_HTTP_TARGETS: 'true' }),
  );
  workerContainer.register({ clock: asValue(clock), loggerOptions: asValue(silentLogging()) });
  const workerServer = buildWorkerServer(workerContainer);
  const workerUrl = await workerServer.listen({ host: LOOPBACK, port: EPHEMERAL_PORT });

  const apiContainer = createApiContainer(loadApiConfig({ ...sharedEnvironment, WORKER_URL: workerUrl }));
  apiContainer.register({ clock: asValue(clock), loggerOptions: asValue(silentLogging()) });
  const apiServer = buildApiServer(apiContainer);
  const apiUrl = await apiServer.listen({ host: LOOPBACK, port: EPHEMERAL_PORT });

  const servers: FastifyInstance[] = [apiServer, workerServer, demoServer];
  return {
    apiUrl,
    workerUrl,
    demoServerUrl,
    clock,
    pool,
    createTenant: (name) => apiContainer.cradle.createTenant.execute({ name }),
    stop: async () => {
      // Servers stop first so no request is in flight when the pools they use are ended.
      for (const server of servers) await server.close();
      await apiContainer.dispose();
      await workerContainer.dispose();
      await pool.end();
      await postgres.stop();
      await rm(secretsDirectory, { recursive: true, force: true });
    },
  };
}
