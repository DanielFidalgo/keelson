import { updateMonitor, type Monitor, type MonitorChanges } from '@keelson/domain';
import { requireOwned } from '../ownership.js';
import type { Clock, IdGenerator, SecretStore, UnitOfWork } from '../ports.js';
import { createMonitorAuthSecret, destroyOrphanedSecret } from './monitor-auth-secret.js';

export interface UpdateMonitorDeps {
  unitOfWork: UnitOfWork;
  secrets: SecretStore;
  clock: Clock;
  ids: IdGenerator;
}

export interface UpdateMonitorInput {
  tenantId: string;
  monitorId: string;
  name?: string;
  intervalSeconds?: number;
  status?: Monitor['status'];
  // Absent keeps the current token, null removes it, a string replaces it.
  authSecret?: string | null;
}

export class UpdateMonitor {
  constructor(private readonly deps: UpdateMonitorDeps) {}

  async execute({ tenantId, monitorId, authSecret, ...changes }: UpdateMonitorInput): Promise<Monitor> {
    const now = this.deps.clock.now();
    // A holder rather than a variable: the transaction callback assigns it and the catch block reads it.
    const created: { secretRef: string | null } = { secretRef: null };
    let outcome: { updated: Monitor; replacedSecretRef: string | null };
    try {
      outcome = await this.deps.unitOfWork.run(async (tx) => {
        const current = requireOwned(await tx.monitors.lockForUpdate(monitorId), tenantId, 'monitor');
        const secretChange = await this.secretChange(monitorId, authSecret);
        created.secretRef = secretChange.authSecretRef ?? null;
        const updated = updateMonitor(current, { ...changes, ...secretChange }, now);
        await tx.monitors.save(updated);
        const replaced = current.authSecretRef !== updated.authSecretRef;
        return { updated, replacedSecretRef: replaced ? current.authSecretRef : null };
      });
    } catch (error) {
      if (created.secretRef !== null) await destroyOrphanedSecret(this.deps.secrets, created.secretRef);
      throw error;
    }
    const { updated, replacedSecretRef } = outcome;
    // Destroyed only after the monitor no longer points at it, so a failure here leaves an orphan, never a dangling reference.
    if (replacedSecretRef !== null) await this.deps.secrets.destroy(replacedSecretRef);
    return updated;
  }

  private async secretChange(monitorId: string, authSecret: string | null | undefined): Promise<MonitorChanges> {
    if (authSecret === undefined) return {};
    if (authSecret === null) return { authSecretRef: null };
    return { authSecretRef: await createMonitorAuthSecret(this.deps, monitorId, authSecret) };
  }
}
