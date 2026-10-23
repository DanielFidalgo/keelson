import { loadApiConfig } from './config.js';
import { createApiContainer } from './container.js';
import { buildApiServer } from './server.js';

const LISTEN_HOST = '0.0.0.0';

// Resolved before listening so a wiring or credential mistake stops the deploy instead of failing the first request.
const ADAPTERS_CHECKED_AT_STARTUP = ['verifier', 'secrets', 'queue', 'inspector'] as const;

const config = loadApiConfig(process.env);
const container = createApiContainer(config);
for (const adapter of ADAPTERS_CHECKED_AT_STARTUP) container.resolve(adapter);
const server = buildApiServer(container);

// Containers stop with SIGTERM; closing the server first lets in-flight requests finish before the pool is ended.
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
