import { createCloudTraceLoggerFactory } from '@keelson/infrastructure';
import { fastifyAwilixPlugin } from '@fastify/awilix';
import type { AwilixContainer } from 'awilix';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { WorkerCradle } from './container.js';
import { requireInternalCaller } from './internal-auth.js';
import { registerDrainRoute } from './routes/drain.js';
import { registerInspectRoute } from './routes/inspect.js';
import { registerProbeRoute } from './routes/probe.js';

declare module '@fastify/awilix' {
  // The plugin types its container by this interface; merging the cradle in is the documented way to type it.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Cradle extends WorkerCradle {}
}

const SERVER_ERROR = 500;

export function buildWorkerServer(container: AwilixContainer<WorkerCradle>): FastifyInstance {
  const { config, loggerOptions } = container.cradle;
  const server = Fastify({
    logger: loggerOptions,
    childLoggerFactory: createCloudTraceLoggerFactory(config.gcpProject),
  });

  // The composition root owns the container and disposes it itself, after the server has stopped taking requests.
  void server.register(fastifyAwilixPlugin, { container, disposeOnClose: false });

  // Internal failures are logged in full but answered with a fixed body, since error messages can name hosts or credentials.
  server.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? SERVER_ERROR;
    if (statusCode < SERVER_ERROR) return reply.code(statusCode).send({ error: error.message });
    request.log.error({ err: error }, 'request failed');
    return reply.code(SERVER_ERROR).send({ error: 'internal error' });
  });

  server.get('/healthz', () => ({ status: 'ok' }));

  // Encapsulated so the authentication hook covers exactly the internal routes and never /healthz.
  void server.register((internal, _options, done) => {
    internal.addHook('onRequest', requireInternalCaller);
    registerProbeRoute(internal);
    registerInspectRoute(internal);
    registerDrainRoute(internal);
    done();
  });

  return server;
}
