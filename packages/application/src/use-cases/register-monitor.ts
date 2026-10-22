import { DomainValidationError, newMonitor, updateMonitor, type Monitor } from '@keelson/domain';
import type { Clock, IdGenerator, Inspection, McpInspector, SecretStore, UnitOfWork } from '../ports.js';
import { createMonitorAuthSecret, destroyOrphanedSecret } from './monitor-auth-secret.js';

export interface RegisterMonitorDeps {
  unitOfWork: UnitOfWork;
  inspector: McpInspector;
  secrets: SecretStore;
  clock: Clock;
  ids: IdGenerator;
}

export interface RegisterMonitorInput {
  tenantId: string;
  name: string;
  url: string;
  intervalSeconds: number;
  authSecret: string | null;
}

export class RegisterMonitor {
  constructor(private readonly deps: RegisterMonitorDeps) {}

  async execute(input: RegisterMonitorInput): Promise<Monitor> {
    const now = this.deps.clock.now();
    const id = this.deps.ids.next();
    const { authSecret, ...fields } = input;
    // Validating first means a malformed request never costs a network call to the server.
    const draft = newMonitor({ id, ...fields, authSecretRef: null }, now);

    const inspection = await this.deps.inspector.inspect({ url: draft.url, bearerToken: authSecret });
    if (inspection.outcome !== 'up') throw new DomainValidationError([notAnMcpServer(inspection)]);

    if (authSecret === null) return this.store(draft);
    const authSecretRef = await createMonitorAuthSecret(this.deps, id, authSecret);
    try {
      return await this.store(updateMonitor(draft, { authSecretRef }, now));
    } catch (error) {
      await destroyOrphanedSecret(this.deps.secrets, authSecretRef);
      throw error;
    }
  }

  private async store(monitor: Monitor): Promise<Monitor> {
    await this.deps.unitOfWork.run((tx) => tx.monitors.save(monitor));
    return monitor;
  }
}

function notAnMcpServer({ outcome, errorDetail }: Inspection): string {
  const reason = errorDetail === null ? outcome : `${outcome}: ${errorDetail}`;
  return `url: not an MCP server (${reason})`;
}
