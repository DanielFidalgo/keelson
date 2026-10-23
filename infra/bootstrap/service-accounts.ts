import * as gcp from '@pulumi/gcp';
import { SERVICE_ACCOUNT_IDS } from '../shared-names';

export interface ServiceAccounts {
  api: gcp.serviceaccount.Account;
  worker: gcp.serviceaccount.Account;
  demoServer: gcp.serviceaccount.Account;
  tasks: gcp.serviceaccount.Account;
  scheduler: gcp.serviceaccount.Account;
  deployer: gcp.serviceaccount.Account;
  preview: gcp.serviceaccount.Account;
}

function createAccount(accountId: string, displayName: string): gcp.serviceaccount.Account {
  return new gcp.serviceaccount.Account(accountId, { accountId, displayName });
}

// One identity per role, so every grant can name exactly the caller it is meant for.
export function createServiceAccounts(): ServiceAccounts {
  return {
    api: createAccount(SERVICE_ACCOUNT_IDS.api, 'Keelson api runtime'),
    worker: createAccount(SERVICE_ACCOUNT_IDS.worker, 'Keelson worker runtime'),
    demoServer: createAccount(SERVICE_ACCOUNT_IDS.demoServer, 'Keelson demo server runtime'),
    tasks: createAccount(SERVICE_ACCOUNT_IDS.tasks, 'Cloud Tasks calling the worker'),
    scheduler: createAccount(SERVICE_ACCOUNT_IDS.scheduler, 'Cloud Scheduler calling the api and worker'),
    deployer: createAccount(SERVICE_ACCOUNT_IDS.deployer, 'GitHub Actions deployments from main'),
    preview: createAccount(SERVICE_ACCOUNT_IDS.preview, 'GitHub Actions read-only previews'),
  };
}
