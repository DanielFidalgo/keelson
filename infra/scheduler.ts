import * as gcp from '@pulumi/gcp';
import type * as pulumi from '@pulumi/pulumi';
import type { ServiceAccounts } from './service-accounts';
import type { ServiceUrls } from './service-urls';

const EVERY_MINUTE = '* * * * *';
const TIME_ZONE = 'Etc/UTC';

interface SchedulerJobDefinition {
  name: string;
  baseUrl: pulumi.Output<string>;
  path: string;
}

function createSchedulerJob(region: string, accounts: ServiceAccounts, definition: SchedulerJobDefinition): gcp.cloudscheduler.Job {
  return new gcp.cloudscheduler.Job(definition.name, {
    name: definition.name,
    region,
    schedule: EVERY_MINUTE,
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
    createSchedulerJob(region, accounts, { name: 'keelson-dispatch', baseUrl: urls.api, path: '/internal/dispatch' }),
    createSchedulerJob(region, accounts, { name: 'keelson-outbox-drain', baseUrl: urls.worker, path: '/internal/outbox/drain' }),
  ];
}
