import type { IdGenerator, SecretStore } from '../ports.js';

// The id suffix keeps a rotated secret from colliding with the one it replaces.
export function createMonitorAuthSecret(
  deps: { secrets: SecretStore; ids: IdGenerator },
  monitorId: string,
  bearerToken: string,
): Promise<string> {
  return deps.secrets.create(`monitor-${monitorId}-auth-${deps.ids.next()}`, bearerToken);
}

// Cleanup after a failed write must not mask the error that caused it, so a failure to destroy is dropped.
export async function destroyOrphanedSecret(secrets: SecretStore, ref: string): Promise<void> {
  try {
    await secrets.destroy(ref);
  } catch {
    // Best effort: the original error is what the caller needs to see.
  }
}
