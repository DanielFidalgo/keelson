import type { CredentialFactory, UnitOfWork } from '../ports/index.js';

export interface AuthenticateApiKeyDeps {
  unitOfWork: UnitOfWork;
  credentials: CredentialFactory;
}

export class AuthenticateApiKey {
  constructor(private readonly deps: AuthenticateApiKeyDeps) {}

  execute(plainText: string): Promise<string | null> {
    const keyHash = this.deps.credentials.hashApiKey(plainText);
    return this.deps.unitOfWork.run((tx) => tx.apiKeys.findTenantIdByHash(keyHash));
  }
}
