import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { SecretStore } from '@keelson/application';
import { OAuth2Client } from 'google-auth-library';
import { SecretManagerStore } from '../gcp/secret-manager-store.js';
import { OidcRequestVerifier } from '../internal-auth/oidc-verifier.js';
import type { InternalRequestVerifier } from '../internal-auth/internal-request-verifier.js';
import { StaticTokenVerifier } from '../internal-auth/static-token.js';
import { FileSecretStore } from '../system/file-secret-store.js';
import type { InternalAuthConfig, SecretStoreConfig } from './schemas.js';

// Plain functions: each app's composition root wraps them in its own container, so no DI library is needed here.
export function createInternalRequestVerifier(auth: InternalAuthConfig): InternalRequestVerifier {
  if (auth.mode === 'static') return new StaticTokenVerifier({ internalStaticToken: auth.staticToken });
  return new OidcRequestVerifier({
    audience: auth.audience,
    allowedEmails: auth.allowedEmails,
    oauth2Client: new OAuth2Client(),
  });
}

export interface ManagedSecretStore {
  secrets: SecretStore;
  // Secret Manager holds a gRPC client that must be closed for the process to exit cleanly; the file store holds nothing.
  close: () => Promise<void>;
}

export function createSecretStore(config: SecretStoreConfig): ManagedSecretStore {
  if (config.kind === 'file') {
    return { secrets: new FileSecretStore({ secretsDirectory: config.directory }), close: () => Promise.resolve() };
  }
  const secretManagerClient = new SecretManagerServiceClient();
  return {
    secrets: new SecretManagerStore({ secretManagerClient, project: config.project }),
    close: () => secretManagerClient.close(),
  };
}
