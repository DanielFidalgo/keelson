import { describe, expect, it } from 'vitest';
import { FileSecretStore } from '../system/file-secret-store.js';
import { SecretManagerStore } from '../gcp/secret-manager-store.js';
import { OidcRequestVerifier } from '../internal-auth/oidc-verifier.js';
import { StaticTokenVerifier } from '../internal-auth/static-token.js';
import { createInternalRequestVerifier, createSecretStore } from './factories.js';

describe('createInternalRequestVerifier', () => {
  it('builds a verifier that accepts the configured static token', async () => {
    const verifier = createInternalRequestVerifier({ mode: 'static', staticToken: 'local-token' });

    expect(verifier).toBeInstanceOf(StaticTokenVerifier);
    await expect(verifier.verify('Bearer local-token')).resolves.toBe(true);
    await expect(verifier.verify('Bearer other')).resolves.toBe(false);
  });

  it('builds the OIDC verifier for the oidc mode', () => {
    const verifier = createInternalRequestVerifier({ mode: 'oidc', audience: 'https://svc', allowedEmails: ['a@x.test'] });

    expect(verifier).toBeInstanceOf(OidcRequestVerifier);
  });
});

describe('createSecretStore', () => {
  it('builds the file store for a directory', async () => {
    const { secrets, close } = createSecretStore({ kind: 'file', directory: '/var/keelson/secrets' });

    expect(secrets).toBeInstanceOf(FileSecretStore);
    await expect(close()).resolves.toBeUndefined();
  });

  it('builds Secret Manager and closes its client', async () => {
    const { secrets, close } = createSecretStore({ kind: 'gcp', project: 'keelson-test' });

    expect(secrets).toBeInstanceOf(SecretManagerStore);
    await expect(close()).resolves.toBeUndefined();
  });
});
