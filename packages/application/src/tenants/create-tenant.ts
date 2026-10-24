import type { Clock, CredentialFactory, IdGenerator, UnitOfWork } from '../ports/index.js';

export interface CreateTenantDeps {
  unitOfWork: UnitOfWork;
  credentials: CredentialFactory;
  clock: Clock;
  ids: IdGenerator;
}

export class CreateTenant {
  constructor(private readonly deps: CreateTenantDeps) {}

  async execute({ name }: { name: string }): Promise<{ tenantId: string; apiKey: string }> {
    const tenantId = this.deps.ids.next();
    const { plainText, hash } = this.deps.credentials.apiKey();
    await this.deps.unitOfWork.run(async (tx) => {
      await tx.tenants.insert({ id: tenantId, name });
      await tx.apiKeys.insert({ id: this.deps.ids.next(), tenantId, keyHash: hash, createdAt: this.deps.clock.now() });
    });
    // The plain text leaves only here; storage keeps the hash, so a lost key can be replaced but never recovered.
    return { tenantId, apiKey: plainText };
  }
}
