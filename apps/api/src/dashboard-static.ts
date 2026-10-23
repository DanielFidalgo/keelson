import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { handleNotFound } from './problem.js';

const INDEX_FILE = 'index.html';
const WILDCARD_PARAM = '*';

interface ClientRoute {
  Params: Record<typeof WILDCARD_PARAM, string>;
}

// Paths the API owns. An unknown path under one of these must stay a problem+json 404 that an API client can
// parse, so the dashboard shell is never answered for them.
const API_PATH_PREFIXES = ['/v1', '/mcp', '/internal', '/reference', '/openapi.yaml', '/health'];

function isApiPath(path: string): boolean {
  return API_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// A script, stylesheet or image that is missing must fail as a 404; answering it with the page would make the
// browser try to run HTML as a script. Only a navigation, which asks for HTML, gets the shell.
function isNavigation(request: FastifyRequest): boolean {
  return request.headers.accept?.includes('text/html') ?? false;
}

function answerClientRoute(request: FastifyRequest<ClientRoute>, reply: FastifyReply): FastifyReply {
  const path = `/${request.params[WILDCARD_PARAM]}`;
  if (isApiPath(path) || !isNavigation(request)) return handleNotFound(request, reply);
  return reply.sendFile(INDEX_FILE);
}

// Without a built dashboard the api still works, so a missing build is logged rather than raised.
export function registerDashboard(server: FastifyInstance, directory: string): void {
  if (!existsSync(join(directory, INDEX_FILE))) {
    server.log.info({ event: 'dashboard.not_built', directory }, 'no dashboard build found; serving the API only');
    return;
  }
  // One route per built file instead of a catch-all: a file in the build can then never answer an API path, because
  // a clash with a route the api registers fails at startup instead of silently winning.
  void server.register(fastifyStatic, { root: directory, wildcard: false });
  server.get<ClientRoute>(`/${WILDCARD_PARAM}`, answerClientRoute);
}
