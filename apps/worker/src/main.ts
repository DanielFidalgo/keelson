import { loadWorkerConfig } from './config.js';
import { createWorkerContainer } from './container.js';
import { buildWorkerServer } from './server.js';

const LISTEN_HOST = '0.0.0.0';

const config = loadWorkerConfig(process.env);
const container = createWorkerContainer(config);
const server = buildWorkerServer(container);

// Containers stop with SIGTERM; closing the server first lets in-flight probes finish before the pool is ended.
process.once('SIGTERM', () => {
  void server.close().then(() => container.dispose());
});

await server.listen({ host: LISTEN_HOST, port: config.port });
