import { bearerTokenFrom } from '@keelson/infrastructure';
import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    // Set by the bearerAuth security handler, which runs before any handler of a secured operation.
    tenantId: string | null;
  }
}

const UNAUTHORIZED = 401;
const SERVER_ERROR = 500;

class InvalidApiKeyError extends Error {
  readonly statusCode = UNAUTHORIZED;

  constructor() {
    super('A valid API key is required.');
    this.name = 'InvalidApiKeyError';
  }
}

// The security handler runs inside fastify-openapi-glue, which answers any error with 401 unless it carries its own
// status. Without this a database outage would tell clients holding a valid key that it is wrong.
class ApiKeyLookupFailedError extends Error {
  readonly statusCode = SERVER_ERROR;

  constructor() {
    super('The API key could not be checked.');
    this.name = 'ApiKeyLookupFailedError';
  }
}

async function tenantOf(request: FastifyRequest, apiKey: string): Promise<string | null> {
  try {
    return await request.diScope.cradle.authenticateApiKey.execute(apiKey);
  } catch (error) {
    request.log.error({ err: error }, 'api key lookup failed');
    throw new ApiKeyLookupFailedError();
  }
}

// fastify-openapi-glue runs this as a preHandler for every operation that declares bearerAuth,
// and turns the error it throws into the 401 answered by the problem error handler.
export const securityHandlers = {
  async bearerAuth(request: FastifyRequest): Promise<void> {
    const apiKey = bearerTokenFrom(request.headers.authorization);
    if (apiKey === null) throw new InvalidApiKeyError();
    const tenantId = await tenantOf(request, apiKey);
    if (tenantId === null) throw new InvalidApiKeyError();
    request.tenantId = tenantId;
  },
};

export function authenticatedTenant(request: FastifyRequest): string {
  if (request.tenantId === null) throw new Error('invariant broken: the operation ran without authentication');
  return request.tenantId;
}
