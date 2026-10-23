import * as gcp from '@pulumi/gcp';
import { memberOf } from './iam';
import type { ServiceAccounts } from './service-accounts';

export const PROBE_QUEUE_NAME = 'probes';

// Equal to PROBE_MAX_ATTEMPTS in apps/worker: the worker logs probe.retries_exhausted on this attempt, so a
// different number here would make that alert fire early or never. index.test.ts compares the two.
const PROBE_MAX_ATTEMPTS = 5;
const MAX_DISPATCHES_PER_SECOND = 5;
const MAX_CONCURRENT_DISPATCHES = 20;
const MIN_BACKOFF = '10s';
const MAX_BACKOFF = '300s';

// The bootstrap stack lets the api act as the tasks service account, which it needs to mint the tokens tasks carry.
export function createProbeQueue(region: string, accounts: ServiceAccounts): gcp.cloudtasks.Queue {
  const queue = new gcp.cloudtasks.Queue('probes', {
    name: PROBE_QUEUE_NAME,
    location: region,
    rateLimits: { maxDispatchesPerSecond: MAX_DISPATCHES_PER_SECOND, maxConcurrentDispatches: MAX_CONCURRENT_DISPATCHES },
    retryConfig: { maxAttempts: PROBE_MAX_ATTEMPTS, minBackoff: MIN_BACKOFF, maxBackoff: MAX_BACKOFF },
  });

  new gcp.cloudtasks.QueueIamMember('probes-api-enqueuer', {
    name: queue.name,
    location: region,
    role: 'roles/cloudtasks.enqueuer',
    member: memberOf(accounts.api),
  });

  return queue;
}
