import * as gcp from '@pulumi/gcp';
import type { DeployConfig } from './config';
import { apiEnvironment } from './environment';
import { imageReference } from './registry';
import type { ServiceAccounts } from './service-accounts';
import type { ServiceUrls } from './service-urls';

export interface JobInputs {
  config: DeployConfig;
  accounts: ServiceAccounts;
  urls: ServiceUrls;
}

// The api image is built from the whole workspace, so the commands are plain files inside it.
const NODE_COMMAND = ['node'];
const MIGRATE_SCRIPT = 'apps/api/dist/commands/migrate.js';
const CREATE_TENANT_SCRIPT = 'apps/api/dist/commands/create-tenant.js';

function createApiImageJob(name: string, script: string, { config, accounts, urls }: JobInputs): gcp.cloudrunv2.Job {
  return new gcp.cloudrunv2.Job(name, {
    name,
    location: config.region,
    deletionProtection: false,
    template: {
      template: {
        serviceAccount: accounts.api,
        // A half-applied migration must be inspected by a person, not repeated automatically.
        maxRetries: 0,
        containers: [
          {
            image: imageReference(config, 'api'),
            commands: NODE_COMMAND,
            args: [script],
            envs: apiEnvironment({ config, accounts, urls }),
          },
        ],
      },
    },
  });
}

// create-tenant takes its --name when executed: `gcloud run jobs execute keelson-create-tenant --args=...`.
export function createJobs(inputs: JobInputs): { migrate: gcp.cloudrunv2.Job; createTenant: gcp.cloudrunv2.Job } {
  return {
    migrate: createApiImageJob('keelson-migrate', MIGRATE_SCRIPT, inputs),
    createTenant: createApiImageJob('keelson-create-tenant', CREATE_TENANT_SCRIPT, inputs),
  };
}
