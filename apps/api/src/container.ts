import { GoogleAuth } from 'google-auth-library';
import {
  AcknowledgeIncident,
  ApproveBaseline,
  AuthenticateApiKey,
  CreateTenant,
  DeleteMonitor,
  DeleteWebhookEndpoint,
  DispatchDueProbes,
  RegisterMonitor,
  RegisterWebhookEndpoint,
  UpdateMonitor,
  UpdateWebhookEndpoint,
  type Clock,
  type CredentialFactory,
  type IdGenerator,
  type McpInspector,
  type ProbeQueue,
  type SecretStore,
  type UnitOfWork,
} from '@keelson/application';
import {
  createInternalRequestVerifier,
  createLoggerOptions,
  createPool,
  createSecretStore,
  GoogleIdTokenCaller,
  PostgresUnitOfWork,
  RandomCredentialFactory,
  StaticTokenCaller,
  SystemClock,
  UuidGenerator,
  WorkerInspectorClient,
  type InternalAuthConfig,
  type InternalCaller,
  type InternalRequestVerifier,
  type ManagedSecretStore,
} from '@keelson/infrastructure';
import { asClass, asFunction, asValue, createContainer, InjectionMode, type AwilixContainer } from 'awilix';
import type { FastifyBaseLogger, FastifyServerOptions } from 'fastify';
import type { ApiConfig } from './config.js';
import { createProbeQueue, type ManagedProbeQueue } from './probe-queue.js';

// Constructors take one deps object whose keys are unique by meaning across the cradle.
export interface ApiCradle {
  config: ApiConfig;
  loggerOptions: NonNullable<FastifyServerOptions['logger']>;
  // The server's own logger, registered by buildApiServer once it exists. Commands never build a server and never log through it.
  logger: FastifyBaseLogger;
  databaseUrl: string;
  pool: ReturnType<typeof createPool>;
  clock: Clock;
  ids: IdGenerator;
  unitOfWork: UnitOfWork;
  credentials: CredentialFactory;
  secretStore: ManagedSecretStore;
  secrets: SecretStore;
  // How this process authenticates to the worker, the same way for inspections and for probe jobs.
  internalCaller: InternalCaller;
  inspector: McpInspector;
  probeQueue: ManagedProbeQueue;
  queue: ProbeQueue;
  verifier: InternalRequestVerifier;
  registerMonitor: RegisterMonitor;
  updateMonitor: UpdateMonitor;
  deleteMonitor: DeleteMonitor;
  approveBaseline: ApproveBaseline;
  acknowledgeIncident: AcknowledgeIncident;
  registerWebhookEndpoint: RegisterWebhookEndpoint;
  updateWebhookEndpoint: UpdateWebhookEndpoint;
  deleteWebhookEndpoint: DeleteWebhookEndpoint;
  authenticateApiKey: AuthenticateApiKey;
  dispatchDueProbes: DispatchDueProbes;
  createTenant: CreateTenant;
}

function createInternalCaller(auth: InternalAuthConfig): InternalCaller {
  if (auth.mode === 'static') return new StaticTokenCaller({ internalStaticToken: auth.staticToken });
  return new GoogleIdTokenCaller({ googleAuth: new GoogleAuth() });
}

// Tests replace registrations on the returned container; nothing here takes override parameters.
export function createApiContainer(config: ApiConfig): AwilixContainer<ApiCradle> {
  const container = createContainer<ApiCradle>({ injectionMode: InjectionMode.PROXY });
  container.register({
    config: asValue(config),
    loggerOptions: asValue(createLoggerOptions()),
    databaseUrl: asValue(config.databaseUrl),
    // Created on first use, so a process that never touches the database never opens a connection.
    pool: asFunction((cradle: ApiCradle) => createPool(cradle.databaseUrl))
      .singleton()
      .disposer((pool) => pool.end()),
    clock: asClass(SystemClock).singleton(),
    ids: asClass(UuidGenerator).singleton(),
    unitOfWork: asClass(PostgresUnitOfWork).singleton(),
    credentials: asClass(RandomCredentialFactory).singleton(),
    secretStore: asFunction(() => createSecretStore(config.secretStore))
      .singleton()
      .disposer(({ close }) => close()),
    secrets: asFunction(({ secretStore }: ApiCradle) => secretStore.secrets).singleton(),
    internalCaller: asFunction(() => createInternalCaller(config.internalAuth)).singleton(),
    // Registration inspects through the worker, so the api process never dials a monitored server itself.
    inspector: asFunction(
      ({ internalCaller }: ApiCradle) => new WorkerInspectorClient({ workerUrl: config.workerUrl, caller: internalCaller }),
    ).singleton(),
    probeQueue: asFunction((cradle: ApiCradle) =>
      createProbeQueue({
        config: config.probeQueue,
        workerUrl: config.workerUrl,
        caller: cradle.internalCaller,
        // The queue is built at startup, before the server and its logger exist, so the logger is read when a failure happens.
        onDeliveryError: (error, { monitorId, slot }) => {
          cradle.logger.error({ event: 'probe.enqueue_failed', monitorId, slot, err: error }, 'probe job was not delivered');
        },
      }),
    )
      .singleton()
      .disposer(({ close }) => close()),
    queue: asFunction(({ probeQueue }: ApiCradle) => probeQueue.queue).singleton(),
    verifier: asFunction(() => createInternalRequestVerifier(config.internalAuth)).singleton(),
    registerMonitor: asClass(RegisterMonitor).singleton(),
    updateMonitor: asClass(UpdateMonitor).singleton(),
    deleteMonitor: asClass(DeleteMonitor).singleton(),
    approveBaseline: asClass(ApproveBaseline).singleton(),
    acknowledgeIncident: asClass(AcknowledgeIncident).singleton(),
    registerWebhookEndpoint: asClass(RegisterWebhookEndpoint).singleton(),
    updateWebhookEndpoint: asClass(UpdateWebhookEndpoint).singleton(),
    deleteWebhookEndpoint: asClass(DeleteWebhookEndpoint).singleton(),
    authenticateApiKey: asClass(AuthenticateApiKey).singleton(),
    dispatchDueProbes: asClass(DispatchDueProbes).singleton(),
    createTenant: asClass(CreateTenant).singleton(),
  });
  return container;
}
