import { SERVICE_ACCOUNT_IDS, serviceAccountEmail } from './shared-names';

// The identities the stack runs as and hands out grants to. They are created by the bootstrap stack, so
// this stack can neither create nor widen them; it only needs their emails.
export interface ServiceAccounts {
  api: string;
  worker: string;
  demoServer: string;
  tasks: string;
  scheduler: string;
}

export function referenceServiceAccounts(project: string): ServiceAccounts {
  const emailOf = (accountId: string): string => serviceAccountEmail(accountId, project);
  return {
    api: emailOf(SERVICE_ACCOUNT_IDS.api),
    worker: emailOf(SERVICE_ACCOUNT_IDS.worker),
    demoServer: emailOf(SERVICE_ACCOUNT_IDS.demoServer),
    tasks: emailOf(SERVICE_ACCOUNT_IDS.tasks),
    scheduler: emailOf(SERVICE_ACCOUNT_IDS.scheduler),
  };
}
