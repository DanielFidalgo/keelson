import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

// Must match the Cloud Tasks queue's max attempts (Task 12): the attempt after the last allowed retry never comes.
export const PROBE_MAX_ATTEMPTS = 5;
const RETRY_COUNT_HEADER = 'x-cloudtasks-taskretrycount';

const probeJobSchema = z.object({ monitorId: z.string().min(1), slot: z.number().int().nonnegative() });

export function registerProbeRoute(server: FastifyInstance): void {
  server.post('/internal/probe', async (request, reply) => {
    const job = probeJobSchema.safeParse(request.body);
    if (!job.success) return reply.code(400).send({ error: 'monitorId and slot are required' });

    try {
      await request.server.diContainer.cradle.runProbe.execute(job.data);
    } catch (error) {
      if (isFinalAttempt(request.headers[RETRY_COUNT_HEADER])) {
        request.log.error({ event: 'probe.retries_exhausted', monitorId: job.data.monitorId, slot: job.data.slot, err: error }, 'probe retries exhausted');
      }
      // Rethrown so the error handler answers 500, which is what makes Cloud Tasks retry.
      throw error;
    }
    return reply.code(204).send();
  });
}

function isFinalAttempt(retryCountHeader: string | string[] | undefined): boolean {
  return Number(retryCountHeader) >= PROBE_MAX_ATTEMPTS - 1;
}
