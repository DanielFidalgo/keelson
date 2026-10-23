import {
  createInternalAuthSchema,
  databaseSchema,
  parseConfigSections,
  optionalText,
  requiredText,
  secretStoreSchema,
  serviceSchema,
  withInternalAuthModeDefault,
  type InternalAuthConfig,
  type SecretStoreConfig,
} from '@keelson/infrastructure';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export { ConfigError } from '@keelson/infrastructure';

// Cloud Tasks replaces the plain HTTP queue exactly when the internal calls use Google ID tokens.
export type ProbeQueueConfig = { kind: 'http' } | { kind: 'cloud-tasks'; queuePath: string; invokerEmail: string };

export interface ApiConfig {
  port: number;
  databaseUrl: string;
  gcpProject: string | undefined;
  workerUrl: string;
  internalAuth: InternalAuthConfig;
  secretStore: SecretStoreConfig;
  probeQueue: ProbeQueueConfig;
  dashboardDirectory: string;
}

// The same relative path works from src/ and from the compiled dist/, and it is where the image puts the build.
export const DEFAULT_DASHBOARD_DIRECTORY = fileURLToPath(new URL('../../dashboard/dist', import.meta.url));

const dashboardSchema = z
  .object({ DASHBOARD_DIR: optionalText })
  .transform((env) => ({ dashboardDirectory: env.DASHBOARD_DIR ?? DEFAULT_DASHBOARD_DIRECTORY }));

const workerSchema = z.object({ WORKER_URL: requiredText }).transform((env) => ({ workerUrl: env.WORKER_URL }));

// The audience is the api's own URL, which Cloud Scheduler puts in the tokens it presents to /internal/dispatch.
const internalAuthSchema = createInternalAuthSchema('API_URL');

const probeQueueSchema = z.preprocess(
  withInternalAuthModeDefault,
  z.discriminatedUnion('INTERNAL_AUTH_MODE', [
    z.object({ INTERNAL_AUTH_MODE: z.literal('static') }).transform((): ProbeQueueConfig => ({ kind: 'http' })),
    z
      .object({
        INTERNAL_AUTH_MODE: z.literal('oidc'),
        GCP_PROJECT: requiredText,
        GCP_LOCATION: requiredText,
        PROBE_QUEUE: requiredText,
        TASKS_INVOKER_EMAIL: requiredText,
      })
      .transform((env): ProbeQueueConfig => ({
        kind: 'cloud-tasks',
        queuePath: `projects/${env.GCP_PROJECT}/locations/${env.GCP_LOCATION}/queues/${env.PROBE_QUEUE}`,
        invokerEmail: env.TASKS_INVOKER_EMAIL,
      })),
  ]),
);

// Parsed once at startup.
export function loadApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const { service, database, worker, internalAuth, secretStore, probeQueue, dashboard } = parseConfigSections('api', env, {
    service: serviceSchema,
    database: databaseSchema,
    worker: workerSchema,
    internalAuth: internalAuthSchema,
    secretStore: secretStoreSchema,
    probeQueue: probeQueueSchema,
    dashboard: dashboardSchema,
  });
  return { ...service, ...database, ...worker, internalAuth, secretStore, probeQueue, ...dashboard };
}
