import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createProblem, replyWithProblem } from './problem.js';

const UNAUTHORIZED = 401;

// An onRequest hook, so a caller without credentials is refused before its body is read or parsed.
async function requireInternalCaller(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { verifier } = request.diScope.cradle;
  if (await verifier.verify(request.headers.authorization)) return;
  await replyWithProblem(reply, createProblem(UNAUTHORIZED, 'A valid internal token is required.'));
}

// Called by Cloud Scheduler, not by API clients, so it sits outside openapi.yaml and behind the internal verifier.
export function registerInternalRoutes(server: FastifyInstance): void {
  // Encapsulated so the authentication hook covers exactly the internal routes.
  void server.register((internal, _options, done) => {
    internal.addHook('onRequest', requireInternalCaller);
    internal.post('/internal/dispatch', (request) => request.diScope.cradle.dispatchDueProbes.execute());
    done();
  });
}
