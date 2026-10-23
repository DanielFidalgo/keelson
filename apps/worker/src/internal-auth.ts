import type { FastifyReply, FastifyRequest } from 'fastify';

// An onRequest hook, so a caller without credentials is refused before its body is read or parsed.
export async function requireInternalCaller(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { verifier } = request.server.diContainer.cradle;
  if (await verifier.verify(request.headers.authorization)) return;
  await reply.code(401).send({ error: 'unauthorized' });
}
