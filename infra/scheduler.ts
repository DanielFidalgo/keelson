import * as gcp from '@pulumi/gcp';
import type * as pulumi from '@pulumi/pulumi';
import type { ServiceAccounts } from './service-accounts';
import type { ServiceUrls } from './service-urls';

// Neon's free compute sleeps only after 5 idle minutes; waking it once per quarter hour keeps the project inside the free
// monthly compute. Monitors run at 900 s, whose slots start on these same quarter hours, so no probe waits for a slot.
const DISPATCH_SCHEDULE = '0,15,30,45 * * * *';
// One minute after dispatch, when the probes have written their outbox rows, so alerts leave in the same waking window.
const DRAIN_SCHEDULE = '1,16,31,46 * * * *';
const TIME_ZONE = 'Etc/UTC';

interface SchedulerJobDefinition {
  name: string;
  baseUrl: pulumi.Output<string>;
  path: string;
  schedule: string;
}

function createSchedulerJob(region: string, accounts: ServiceAccounts, definition: SchedulerJobDefinition): gcp.cloudscheduler.Job {
  return new gcp.cloudscheduler.Job(definition.name, {
    name: definition.name,
    region,
    schedule: definition.schedule,
    timeZone: TIME_ZONE,
    httpTarget: {
      httpMethod: 'POST',
      uri: definition.baseUrl.apply((baseUrl) => `${baseUrl}${definition.path}`),
      // The token's audience is the service URL: that is the value the receiving service verifies it against.
      oidcToken: { serviceAccountEmail: accounts.scheduler, audience: definition.baseUrl },
    },
  });
}

export function createSchedulerJobs(region: string, accounts: ServiceAccounts, urls: ServiceUrls): gcp.cloudscheduler.Job[] {
  return [
    createSchedulerJob(region, accounts, { name: 'keelson-dispatch', baseUrl: urls.api, path: '/internal/dispatch', schedule: DISPATCH_SCHEDULE }),
    createSchedulerJob(region, accounts, { name: 'keelson-outbox-drain', baseUrl: urls.worker, path: '/internal/outbox/drain', schedule: DRAIN_SCHEDULE }),
  ];
}
