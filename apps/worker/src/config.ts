import { databaseSchema, createInternalAuthSchema, parseConfigSections, secretStoreSchema, serviceSchema } from '@keelson/infrastructure';
import type { InternalAuthConfig, SecretStoreConfig } from '@keelson/infrastructure';
import { z } from 'zod';

export { ConfigError } from '@keelson/infrastructure';
export type { InternalAuthConfig, SecretStoreConfig };

export interface WorkerConfig {
  port: number;
  databaseUrl: string;
  gcpProject: string | undefined;
  allowPrivateTargets: boolean;
  allowHttpTargets: boolean;
  internalAuth: InternalAuthConfig;
  secretStore: SecretStoreConfig;
}

const targetPolicySchema = z
  .object({
    ALLOW_PRIVATE_TARGETS: z.stringbool().default(false),
    ALLOW_HTTP_TARGETS: z.stringbool().default(false),
  })
  .transform((env) => ({ allowPrivateTargets: env.ALLOW_PRIVATE_TARGETS, allowHttpTargets: env.ALLOW_HTTP_TARGETS }));

// The audience is the worker's own URL, which Cloud Tasks and the api put in the tokens they present.
const internalAuthSchema = createInternalAuthSchema('WORKER_URL');

// Parsed once at startup.
export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const { service, database, targetPolicy, internalAuth, secretStore } = parseConfigSections('worker', env, {
    service: serviceSchema,
    database: databaseSchema,
    targetPolicy: targetPolicySchema,
    internalAuth: internalAuthSchema,
    secretStore: secretStoreSchema,
  });
  return { ...service, ...database, ...targetPolicy, internalAuth, secretStore };
}
