import { requireOwned } from '../ownership.js';
import type { SecretStore, UnitOfWork } from '../ports.js';

export interface DeleteMonitorDeps {
  unitOfWork: UnitOfWork;
  secrets: SecretStore;
}

export class DeleteMonitor {
  constructor(private readonly deps: DeleteMonitorDeps) {}

  async execute({ tenantId, monitorId }: { tenantId: string; monitorId: string }): Promise<void> {
    const authSecretRef = await this.deps.unitOfWork.run(async (tx) => {
      const monitor = requireOwned(await tx.monitors.lockForUpdate(monitorId), tenantId, 'monitor');
      await tx.monitors.delete(monitor.id);
      return monitor.authSecretRef;
    });
    // Destroyed after the commit: a monitor must never survive pointing at a secret that is already gone.
    if (authSecretRef !== null) await this.deps.secrets.destroy(authSecretRef);
  }
}
