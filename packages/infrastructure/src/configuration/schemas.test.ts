import { describe, expect, it } from 'vitest';
import { createInternalAuthSchema, databaseSchema, secretStoreSchema, serviceSchema } from './schemas.js';

const apiAuthSchema = createInternalAuthSchema('API_URL');

describe('serviceSchema', () => {
  it('defaults the port and treats a blank project as unset', () => {
    expect(serviceSchema.parse({ GCP_PROJECT: '' })).toEqual({ port: 8080, gcpProject: undefined });
  });

  it('reads the port and project', () => {
    expect(serviceSchema.parse({ PORT: '9000', GCP_PROJECT: 'keelson' })).toEqual({ port: 9000, gcpProject: 'keelson' });
  });
});

describe('databaseSchema', () => {
  it('reads the connection string', () => {
    expect(databaseSchema.parse({ DATABASE_URL: 'postgres://db/keelson' })).toEqual({ databaseUrl: 'postgres://db/keelson' });
  });

  it('requires a connection string', () => {
    expect(databaseSchema.safeParse({}).success).toBe(false);
  });
});

describe('createInternalAuthSchema', () => {
  it('defaults to oidc so a forgotten variable never selects the weaker local mode', () => {
    const result = apiAuthSchema.safeParse({ API_URL: 'https://api.example', INTERNAL_INVOKER_EMAILS: 'a@x.test' });

    expect(result.data).toEqual({ mode: 'oidc', audience: 'https://api.example', allowedEmails: ['a@x.test'] });
  });

  it('takes the default audience from the variable the service names, not from another service', () => {
    const result = apiAuthSchema.safeParse({ WORKER_URL: 'https://worker.example', INTERNAL_INVOKER_EMAILS: 'a@x.test' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('is required when API_URL is not set');
  });

  it('prefers an explicit OIDC_AUDIENCE', () => {
    const result = apiAuthSchema.safeParse({
      OIDC_AUDIENCE: 'https://custom',
      API_URL: 'https://api.example',
      INTERNAL_INVOKER_EMAILS: 'a@x.test',
    });

    expect(result.data).toMatchObject({ audience: 'https://custom' });
  });

  it('parses the static mode', () => {
    const result = apiAuthSchema.safeParse({ INTERNAL_AUTH_MODE: 'static', INTERNAL_STATIC_TOKEN: 'local' });

    expect(result.data).toEqual({ mode: 'static', staticToken: 'local' });
  });
});

describe('secretStoreSchema', () => {
  it('defaults to Secret Manager and needs a project for it', () => {
    expect(secretStoreSchema.safeParse({ GCP_PROJECT: 'keelson' }).data).toEqual({ kind: 'gcp', project: 'keelson' });
    expect(secretStoreSchema.safeParse({}).success).toBe(false);
  });

  it('selects the file store from a directory', () => {
    expect(secretStoreSchema.safeParse({ SECRET_STORE: 'file', SECRETS_DIR: '/secrets' }).data).toEqual({
      kind: 'file',
      directory: '/secrets',
    });
  });
});
