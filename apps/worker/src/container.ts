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
  createInternalRequestVerifier,
  createLoggerOptions,
  createPool,
  createSecretStore,
  PostgresUnitOfWork,
  SystemClock,
  UuidGenerator,
  type InternalRequestVerifier,
  type ManagedSecretStore,
} from '@keelson/infrastructure';
import {
  createGuardedFetch,
  SdkMcpInspector,
  SlackWebhookChannel,
  StandardWebhookChannel,
  type TargetPolicy,
} from '@keelson/infrastructure/egress';
import { asClass, asFunction, asValue, createContainer, InjectionMode, type AwilixContainer } from 'awilix';
import type { FastifyServerOptions } from 'fastify';
import type { WorkerConfig } from './config.js';

// Constructors take one deps object whose keys are unique by meaning across the cradle; `fetch` is the SSRF-guarded one.
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
  secretStore: ManagedSecretStore;
  secrets: SecretStore;
  channels: Record<WebhookFormat, AlertChannel>;
  verifier: InternalRequestVerifier;
  runProbe: RunProbe;
  drainOutbox: DrainOutbox;
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
    verifier: asFunction(() => createInternalRequestVerifier(config.internalAuth)).singleton(),
    secretStore: asFunction(() => createSecretStore(config.secretStore))
      .singleton()
      .disposer(({ close }) => close()),
    secrets: asFunction(({ secretStore }: WorkerCradle) => secretStore.secrets).singleton(),
  });
  return container;
}
