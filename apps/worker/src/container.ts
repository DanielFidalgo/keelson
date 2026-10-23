import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import {
  DrainOutbox,
  RunProbe,
  type AlertChannel,
  type Clock,
  type IdGenerator,
  type McpInspector,
  type SecretStore,
  type UnitOfWork,
} from '@keelson/application';
import type { WebhookFormat } from '@keelson/domain';
import {
  createLoggerOptions,
  createPool,
  FileSecretStore,
  OidcRequestVerifier,
  PostgresUnitOfWork,
  SecretManagerStore,
  StaticTokenVerifier,
  SystemClock,
  UuidGenerator,
  type InternalRequestVerifier,
} from '@keelson/infrastructure';
import {
  createGuardedFetch,
  SdkMcpInspector,
  SlackWebhookChannel,
  StandardWebhookChannel,
  type TargetPolicy,
} from '@keelson/infrastructure/egress';
import { asClass, asFunction, asValue, createContainer, InjectionMode, type AwilixContainer, type NameAndRegistrationPair } from 'awilix';
import type { FastifyServerOptions } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import type { InternalAuthConfig, SecretStoreConfig, WorkerConfig } from './config.js';

// Constructors take one deps object whose keys are unique by meaning across the cradle; `fetch` is the SSRF-guarded one.
// The keys after `drainOutbox` exist only for the configured variant, and resolving another variant's key throws.
export interface WorkerCradle {
  config: WorkerConfig;
  loggerOptions: NonNullable<FastifyServerOptions['logger']>;
  databaseUrl: string;
  pool: ReturnType<typeof createPool>;
  targetPolicy: TargetPolicy;
  fetch: typeof fetch;
  clock: Clock;
  ids: IdGenerator;
  unitOfWork: UnitOfWork;
  inspector: McpInspector;
  secrets: SecretStore;
  channels: Record<WebhookFormat, AlertChannel>;
  verifier: InternalRequestVerifier;
  runProbe: RunProbe;
  drainOutbox: DrainOutbox;
  audience?: string;
  allowedEmails?: string[];
  oauth2Client?: OAuth2Client;
  internalStaticToken?: string;
  project?: string;
  secretManagerClient?: SecretManagerServiceClient;
  secretsDirectory?: string;
}

type Registrations = NameAndRegistrationPair<WorkerCradle>;

function internalAuthRegistrations(auth: InternalAuthConfig): Registrations {
  if (auth.mode === 'static') {
    return {
      internalStaticToken: asValue(auth.staticToken),
      verifier: asClass(StaticTokenVerifier).singleton(),
    };
  }
  return {
    audience: asValue(auth.audience),
    allowedEmails: asValue(auth.allowedEmails),
    oauth2Client: asFunction(() => new OAuth2Client()).singleton(),
    verifier: asClass(OidcRequestVerifier).singleton(),
  };
}

function secretStoreRegistrations(store: SecretStoreConfig): Registrations {
  if (store.kind === 'file') {
    return {
      secretsDirectory: asValue(store.directory),
      secrets: asClass(FileSecretStore).singleton(),
    };
  }
  return {
    project: asValue(store.project),
    secretManagerClient: asFunction(() => new SecretManagerServiceClient())
      .singleton()
      .disposer((client) => client.close()),
    secrets: asClass(SecretManagerStore).singleton(),
  };
}

// Tests replace registrations on the returned container; nothing here takes override parameters.
export function createWorkerContainer(config: WorkerConfig): AwilixContainer<WorkerCradle> {
  const container = createContainer<WorkerCradle>({ injectionMode: InjectionMode.PROXY });
  container.register({
    config: asValue(config),
    loggerOptions: asValue(createLoggerOptions()),
    databaseUrl: asValue(config.databaseUrl),
    // Created on first use, so a process that never touches the database never opens a connection.
    pool: asFunction((cradle: WorkerCradle) => createPool(cradle.databaseUrl))
      .singleton()
      .disposer((pool) => pool.end()),
    targetPolicy: asValue({ allowPrivateAddresses: config.allowPrivateTargets, allowHttp: config.allowHttpTargets }),
    fetch: asFunction((cradle: WorkerCradle) => createGuardedFetch(cradle.targetPolicy)).singleton(),
    clock: asClass(SystemClock).singleton(),
    ids: asClass(UuidGenerator).singleton(),
    unitOfWork: asClass(PostgresUnitOfWork).singleton(),
    inspector: asClass(SdkMcpInspector).singleton(),
    channels: asFunction((cradle: WorkerCradle) => ({
      standard: new StandardWebhookChannel({ fetch: cradle.fetch }),
      slack: new SlackWebhookChannel({ fetch: cradle.fetch }),
    })).singleton(),
    runProbe: asClass(RunProbe).singleton(),
    drainOutbox: asClass(DrainOutbox).singleton(),
    ...internalAuthRegistrations(config.internalAuth),
    ...secretStoreRegistrations(config.secretStore),
  });
  return container;
}
