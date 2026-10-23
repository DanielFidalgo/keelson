import { describe, expect, it } from 'vitest';
import { ConfigError, loadWorkerConfig } from './config.js';

const STATIC_LOCAL_ENV = {
  DATABASE_URL: 'postgres://keelson@localhost/keelson',
  INTERNAL_AUTH_MODE: 'static',
  INTERNAL_STATIC_TOKEN: 'local-token',
  SECRET_STORE: 'file',
  SECRETS_DIR: '/var/keelson/secrets',
};

const OIDC_ENV = {
  DATABASE_URL: 'postgres://keelson@localhost/keelson',
  INTERNAL_AUTH_MODE: 'oidc',
  WORKER_URL: 'https://worker.example.run.app',
  INTERNAL_INVOKER_EMAILS: 'tasks@example.iam.gserviceaccount.com, api@example.iam.gserviceaccount.com',
  GCP_PROJECT: 'keelson-prod',
  SECRET_STORE: 'gcp',
};

describe('loadWorkerConfig', () => {
  it('parses a local static-token configuration with defaults for the optional values', () => {
    const config = loadWorkerConfig(STATIC_LOCAL_ENV);

    expect(config).toEqual({
      port: 8080,
      databaseUrl: STATIC_LOCAL_ENV.DATABASE_URL,
      gcpProject: undefined,
      allowPrivateTargets: false,
      allowHttpTargets: false,
      internalAuth: { mode: 'static', staticToken: 'local-token' },
      secretStore: { kind: 'file', directory: '/var/keelson/secrets' },
    });
  });

  it('parses a production configuration and audiences default to the worker URL', () => {
    const config = loadWorkerConfig({ ...OIDC_ENV, PORT: '9000' });

    expect(config.port).toBe(9000);
    expect(config.gcpProject).toBe('keelson-prod');
    expect(config.internalAuth).toEqual({
      mode: 'oidc',
      audience: 'https://worker.example.run.app',
      allowedEmails: ['tasks@example.iam.gserviceaccount.com', 'api@example.iam.gserviceaccount.com'],
    });
    expect(config.secretStore).toEqual({ kind: 'gcp', project: 'keelson-prod' });
  });

  it('an explicit OIDC_AUDIENCE wins over WORKER_URL', () => {
    const config = loadWorkerConfig({ ...OIDC_ENV, OIDC_AUDIENCE: 'https://custom.example' });

    expect(config.internalAuth).toMatchObject({ audience: 'https://custom.example' });
  });

  it('reads the target policy switches', () => {
    const config = loadWorkerConfig({ ...STATIC_LOCAL_ENV, ALLOW_PRIVATE_TARGETS: 'true', ALLOW_HTTP_TARGETS: 'true' });

    expect(config).toMatchObject({ allowPrivateTargets: true, allowHttpTargets: true });
  });

  it('lists every problem at once rather than stopping at the first', () => {
    const failure = captured(() => loadWorkerConfig({ INTERNAL_AUTH_MODE: 'static', SECRET_STORE: 'file', PORT: 'many' }));

    expect(failure).toBeInstanceOf(ConfigError);
    expect(failure.message).toContain('PORT');
    expect(failure.message).toContain('DATABASE_URL');
    expect(failure.message).toContain('INTERNAL_STATIC_TOKEN');
    expect(failure.message).toContain('SECRETS_DIR');
  });

  it.each([
    ['oidc without an audience', { ...OIDC_ENV, WORKER_URL: undefined }, 'OIDC_AUDIENCE'],
    ['oidc without invoker emails', { ...OIDC_ENV, INTERNAL_INVOKER_EMAILS: ' , ' }, 'INTERNAL_INVOKER_EMAILS'],
    ['gcp secrets without a project', { ...OIDC_ENV, GCP_PROJECT: undefined }, 'GCP_PROJECT'],
    ['an unknown auth mode', { ...OIDC_ENV, INTERNAL_AUTH_MODE: 'none' }, 'INTERNAL_AUTH_MODE'],
    ['an unknown secret store', { ...OIDC_ENV, SECRET_STORE: 'vault' }, 'SECRET_STORE'],
    ['a non-boolean switch', { ...OIDC_ENV, ALLOW_HTTP_TARGETS: 'sometimes' }, 'ALLOW_HTTP_TARGETS'],
  ])('rejects %s', (_description, env, variable) => {
    expect(captured(() => loadWorkerConfig(env)).message).toContain(variable);
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
