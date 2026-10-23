import { FileSecretStore, OidcRequestVerifier, SecretManagerStore, StaticTokenVerifier } from '@keelson/infrastructure';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkerConfig } from './config.js';
import { createWorkerContainer } from './container.js';

const BASE_ENV = { DATABASE_URL: 'postgres://keelson@localhost/keelson' };
const LOCAL_ENV = {
  ...BASE_ENV,
  INTERNAL_AUTH_MODE: 'static',
  INTERNAL_STATIC_TOKEN: 'local-token',
  SECRET_STORE: 'file',
  SECRETS_DIR: '/var/keelson/secrets',
};
const CLOUD_ENV = {
  ...BASE_ENV,
  INTERNAL_AUTH_MODE: 'oidc',
  WORKER_URL: 'https://worker.example.run.app',
  INTERNAL_INVOKER_EMAILS: 'tasks@example.iam.gserviceaccount.com',
  GCP_PROJECT: 'keelson-prod',
  SECRET_STORE: 'gcp',
};

const containers: Array<ReturnType<typeof createWorkerContainer>> = [];

afterEach(async () => {
  await Promise.all(containers.splice(0).map((container) => container.dispose()));
});

function containerFor(env: Record<string, string>): ReturnType<typeof createWorkerContainer> {
  const container = createWorkerContainer(loadWorkerConfig(env));
  containers.push(container);
  return container;
}

describe('createWorkerContainer', () => {
  it('uses the static token verifier and the file secret store for a local configuration', () => {
    const { verifier, secrets } = containerFor(LOCAL_ENV).cradle;

    expect(verifier).toBeInstanceOf(StaticTokenVerifier);
    expect(secrets).toBeInstanceOf(FileSecretStore);
  });

  it('uses the OIDC verifier and Secret Manager for a cloud configuration', () => {
    const { verifier, secrets } = containerFor(CLOUD_ENV).cradle;

    expect(verifier).toBeInstanceOf(OidcRequestVerifier);
    expect(secrets).toBeInstanceOf(SecretManagerStore);
  });

  it('serves each use case as a singleton', () => {
    const container = containerFor(LOCAL_ENV);

    expect(container.cradle.runProbe).toBe(container.cradle.runProbe);
  });

  it('wires a standard and a slack channel over the guarded fetch', () => {
    const { channels } = containerFor(LOCAL_ENV).cradle;

    expect(Object.keys(channels).sort()).toEqual(['slack', 'standard']);
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
