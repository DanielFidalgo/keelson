import { readFileSync } from 'node:fs';
import { fastifyAwilixPlugin } from '@fastify/awilix';
import scalarApiReference from '@scalar/fastify-api-reference';
import { createCloudTraceLoggerFactory } from '@keelson/infrastructure';
import type { AwilixContainer } from 'awilix';
import Fastify, { type FastifyInstance } from 'fastify';
import openApiGlue from 'fastify-openapi-glue';
import { securityHandlers } from './auth.js';
import type { ApiCradle } from './container.js';
import { serviceHandlers } from './handlers.js';
import { registerInternalRoutes } from './internal-routes.js';
import { handleError, handleNotFound } from './problem.js';

declare module '@fastify/awilix' {
  // The plugin types its container by this interface; merging the cradle in is the documented way to type it.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Cradle extends ApiCradle {}
}

// The same relative path works from src/ and from the compiled dist/, which sit side by side.
const SPECIFICATION_PATH = new URL('../openapi.yaml', import.meta.url);
const SPECIFICATION_URL_PATH = '/openapi.yaml';
const REFERENCE_URL_PATH = '/reference';

export function buildApiServer(container: AwilixContainer<ApiCradle>): FastifyInstance {
  const { config, loggerOptions } = container.cradle;
  const server = Fastify({
    logger: loggerOptions,
    childLoggerFactory: createCloudTraceLoggerFactory(config.gcpProject),
    // The default silently drops unknown body fields and stops at the first violation. Refusing the fields and
    // reporting every violation tells the client all that is wrong with its request in one round trip.
    ajv: { customOptions: { removeAdditional: false, allErrors: true } },
  });

  // The composition root owns the container and disposes it itself, after the server has stopped taking requests.
  void server.register(fastifyAwilixPlugin, { container, disposeOnClose: false });
  server.decorateRequest('tenantId', null);
  server.setErrorHandler(handleError);
  server.setNotFoundHandler(handleNotFound);

  server.get('/healthz', () => ({ status: 'ok' }));

  const specification = readFileSync(SPECIFICATION_PATH, 'utf8');
  server.get(SPECIFICATION_URL_PATH, (_request, reply) => reply.type('application/yaml; charset=utf-8').send(specification));
  void server.register(scalarApiReference, {
    routePrefix: REFERENCE_URL_PATH,
    configuration: { url: SPECIFICATION_URL_PATH },
  });

  void server.register(openApiGlue, { specification, serviceHandlers, securityHandlers });
  registerInternalRoutes(server);

  return server;
}
