import { loadWorkerConfig } from './config.js';
import { createWorkerContainer } from './container.js';
import { buildWorkerServer } from './server.js';

const LISTEN_HOST = '0.0.0.0';

// Resolved before listening so a wiring or credential mistake stops the deploy instead of failing the first request.
const ADAPTERS_CHECKED_AT_STARTUP = ['verifier', 'secrets', 'inspector', 'channels'] as const;

const config = loadWorkerConfig(process.env);
const container = createWorkerContainer(config);
for (const adapter of ADAPTERS_CHECKED_AT_STARTUP) container.resolve(adapter);
const server = buildWorkerServer(container);

// Containers stop with SIGTERM; closing the server first lets in-flight probes finish before the pool is ended.
process.once('SIGTERM', () => {
  server
    .close()
    .then(() => container.dispose())
    .catch((error: unknown) => {
      server.log.error({ err: error }, 'shutdown failed');
      process.exitCode = 1;
    });
});

await server.listen({ host: LISTEN_HOST, port: config.port });
