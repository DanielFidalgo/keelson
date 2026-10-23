import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_DASHBOARD_DIRECTORY, loadApiConfig } from './config.js';

const STATIC_LOCAL_ENV = {
  DATABASE_URL: 'postgres://keelson@localhost/keelson',
  WORKER_URL: 'http://worker:8080',
  INTERNAL_AUTH_MODE: 'static',
  INTERNAL_STATIC_TOKEN: 'local-token',
  SECRET_STORE: 'file',
  SECRETS_DIR: '/var/keelson/secrets',
};

const OIDC_ENV = {
  DATABASE_URL: 'postgres://keelson@localhost/keelson',
  WORKER_URL: 'https://worker.example.run.app',
  API_URL: 'https://api.example.run.app',
  INTERNAL_INVOKER_EMAILS: 'scheduler@example.iam.gserviceaccount.com',
  GCP_LOCATION: 'europe-west1',
  PROBE_QUEUE: 'probes',
  TASKS_INVOKER_EMAIL: 'tasks@example.iam.gserviceaccount.com',
  GCP_PROJECT: 'keelson-prod',
};

describe('loadApiConfig', () => {
  it('parses a local configuration, which needs no Cloud Tasks settings', () => {
    expect(loadApiConfig(STATIC_LOCAL_ENV)).toEqual({
      port: 8080,
      databaseUrl: STATIC_LOCAL_ENV.DATABASE_URL,
      gcpProject: undefined,
      workerUrl: 'http://worker:8080',
      internalAuth: { mode: 'static', staticToken: 'local-token' },
      secretStore: { kind: 'file', directory: '/var/keelson/secrets' },
      probeQueue: { kind: 'http' },
      dashboardDirectory: DEFAULT_DASHBOARD_DIRECTORY,
    });
  });

  it('serves the dashboard from DASHBOARD_DIR when set, and treats a blank value as unset', () => {
    expect(loadApiConfig({ ...STATIC_LOCAL_ENV, DASHBOARD_DIR: '/srv/dashboard' }).dashboardDirectory).toBe('/srv/dashboard');
    expect(loadApiConfig({ ...STATIC_LOCAL_ENV, DASHBOARD_DIR: '' }).dashboardDirectory).toBe(DEFAULT_DASHBOARD_DIRECTORY);
  });

  it('defaults to the dashboard build next to the api, which is where the image puts it', () => {
    expect(DEFAULT_DASHBOARD_DIRECTORY).toMatch(/[\\/]apps[\\/]dashboard[\\/]dist$/);
  });

  it('parses a production configuration; the scheduler token audience is the api own URL', () => {
    const config = loadApiConfig(OIDC_ENV);

    expect(config.internalAuth).toEqual({
      mode: 'oidc',
      audience: 'https://api.example.run.app',
      allowedEmails: ['scheduler@example.iam.gserviceaccount.com'],
    });
    expect(config.probeQueue).toEqual({
      kind: 'cloud-tasks',
      queuePath: 'projects/keelson-prod/locations/europe-west1/queues/probes',
      invokerEmail: OIDC_ENV.TASKS_INVOKER_EMAIL,
    });
    expect(config.secretStore).toEqual({ kind: 'gcp', project: 'keelson-prod' });
  });

  it('lists every problem at once, naming the api', () => {
    const failure = captured(() => loadApiConfig({ INTERNAL_AUTH_MODE: 'static', SECRET_STORE: 'file' }));

    expect(failure).toBeInstanceOf(ConfigError);
    expect(failure.message).toContain('invalid api configuration');
    expect(failure.message).toContain('DATABASE_URL');
    expect(failure.message).toContain('WORKER_URL');
    expect(failure.message).toContain('INTERNAL_STATIC_TOKEN');
    expect(failure.message).toContain('SECRETS_DIR');
  });

  it.each([
    ['oidc without a location', { ...OIDC_ENV, GCP_LOCATION: undefined }, 'GCP_LOCATION'],
    ['oidc without a queue name', { ...OIDC_ENV, PROBE_QUEUE: undefined }, 'PROBE_QUEUE'],
    ['oidc without a tasks invoker', { ...OIDC_ENV, TASKS_INVOKER_EMAIL: undefined }, 'TASKS_INVOKER_EMAIL'],
    ['oidc without an audience', { ...OIDC_ENV, API_URL: undefined }, 'API_URL'],
    ['oidc without scheduler emails', { ...OIDC_ENV, INTERNAL_INVOKER_EMAILS: '' }, 'INTERNAL_INVOKER_EMAILS'],
  ])('rejects %s', (_description, env, variable) => {
    expect(captured(() => loadApiConfig(env)).message).toContain(variable);
  });
});

function captured(work: () => unknown): Error {
  try {
    work();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('expected the work to throw');
}
