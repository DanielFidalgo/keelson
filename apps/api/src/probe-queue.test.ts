import { asValue } from 'awilix';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadApiConfig } from './config.js';
import { createApiContainer } from './container.js';
import { buildApiServer } from './server.js';

// Nothing listens on port 1, so the worker call fails the way an unreachable worker does.
const UNREACHABLE_WORKER_URL = 'http://127.0.0.1:1';
const ENVIRONMENT = {
  DATABASE_URL: 'postgres://keelson@localhost/keelson',
  WORKER_URL: UNREACHABLE_WORKER_URL,
  INTERNAL_AUTH_MODE: 'static',
  INTERNAL_STATIC_TOKEN: 'test-internal-token',
  SECRET_STORE: 'file',
  SECRETS_DIR: '/var/keelson/secrets',
};

const containers: Array<ReturnType<typeof createApiContainer>> = [];

afterEach(async () => {
  await Promise.all(containers.splice(0).map((container) => container.dispose()));
});

describe('the local probe queue in the api', () => {
  it('logs probe.enqueue_failed through the server logger when the worker cannot be reached', async () => {
    const container = createApiContainer(loadApiConfig(ENVIRONMENT));
    containers.push(container);
    container.register({ loggerOptions: asValue({ level: 'silent' }) });
    // The queue is resolved before the server is built, as main.ts does at startup.
    const { queue } = container.cradle;
    const server = buildApiServer(container);
    const logged = vi.spyOn(server.log, 'error');

    await queue.enqueue({ monitorId: 'mon_1', slot: 7 });

    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'probe.enqueue_failed', monitorId: 'mon_1', slot: 7 }),
        expect.any(String),
      );
    });
    await server.close();
  });
});
