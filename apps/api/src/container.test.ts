import {
  CloudTasksProbeQueue,
  FileSecretStore,
  GoogleIdTokenCaller,
  HttpProbeQueue,
  OidcRequestVerifier,
  RandomCredentialFactory,
  SecretManagerStore,
  StaticTokenCaller,
  StaticTokenVerifier,
  WorkerInspectorClient,
} from '@keelson/infrastructure';
import { afterEach, describe, expect, it } from 'vitest';
import { loadApiConfig } from './config.js';
import { createApiContainer } from './container.js';

const BASE_ENV = { DATABASE_URL: 'postgres://keelson@localhost/keelson', WORKER_URL: 'https://worker.example.run.app' };
const LOCAL_ENV = {
  ...BASE_ENV,
  INTERNAL_AUTH_MODE: 'static',
  INTERNAL_STATIC_TOKEN: 'local-token',
  SECRET_STORE: 'file',
  SECRETS_DIR: '/var/keelson/secrets',
};
const CLOUD_ENV = {
  ...BASE_ENV,
  API_URL: 'https://api.example.run.app',
  INTERNAL_INVOKER_EMAILS: 'scheduler@example.iam.gserviceaccount.com',
  GCP_LOCATION: 'europe-west1',
  PROBE_QUEUE: 'probes',
  TASKS_INVOKER_EMAIL: 'tasks@example.iam.gserviceaccount.com',
  GCP_PROJECT: 'keelson-prod',
};

const containers: Array<ReturnType<typeof createApiContainer>> = [];

afterEach(async () => {
  await Promise.all(containers.splice(0).map((container) => container.dispose()));
});

function containerFor(env: Record<string, string>): ReturnType<typeof createApiContainer> {
  const container = createApiContainer(loadApiConfig(env));
  containers.push(container);
  return container;
}

describe('createApiContainer', () => {
  it('wires the static token, the HTTP probe queue and the file secret store for a local configuration', () => {
    const { verifier, internalCaller, queue, secrets } = containerFor(LOCAL_ENV).cradle;

    expect(verifier).toBeInstanceOf(StaticTokenVerifier);
    expect(internalCaller).toBeInstanceOf(StaticTokenCaller);
    expect(queue).toBeInstanceOf(HttpProbeQueue);
    expect(secrets).toBeInstanceOf(FileSecretStore);
  });

  it('wires Google ID tokens, Cloud Tasks and Secret Manager for a cloud configuration', () => {
    const { verifier, internalCaller, queue, secrets } = containerFor(CLOUD_ENV).cradle;

    expect(verifier).toBeInstanceOf(OidcRequestVerifier);
    expect(internalCaller).toBeInstanceOf(GoogleIdTokenCaller);
    expect(queue).toBeInstanceOf(CloudTasksProbeQueue);
    expect(secrets).toBeInstanceOf(SecretManagerStore);
  });

  it('registers monitors through the worker, never by dialling the monitored server itself', () => {
    expect(containerFor(LOCAL_ENV).cradle.inspector).toBeInstanceOf(WorkerInspectorClient);
  });

  it('issues credentials with the random factory', () => {
    expect(containerFor(LOCAL_ENV).cradle.credentials).toBeInstanceOf(RandomCredentialFactory);
  });

  it('serves each use case as a singleton', () => {
    const container = containerFor(LOCAL_ENV);

    expect(container.cradle.registerMonitor).toBe(container.cradle.registerMonitor);
  });

  it('does not create the connection pool until something needs the database', () => {
    expect(containerFor(LOCAL_ENV).cache.has('pool')).toBe(false);
  });

  it('ends the connection pool when the container is disposed, so SIGTERM leaves no open connections', async () => {
    const container = containerFor(LOCAL_ENV);
    const { pool } = container.cradle;

    await container.dispose();

    expect(pool.ended).toBe(true);
  });
});
