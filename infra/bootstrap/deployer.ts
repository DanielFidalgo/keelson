import * as gcp from '@pulumi/gcp';
import { memberOf } from '../iam';
import type { BootstrapConfig } from './config';
import { grantProjectRole } from './project-roles';
import type { ServiceAccounts } from './service-accounts';

const SERVICE_ACCOUNT_USER_ROLE = 'roles/iam.serviceAccountUser';

// Each role is what one part of the main stack needs and no more. None of them can edit project IAM, create
// service accounts, custom roles or workload identity pools, or read a secret's value, so a deployer token
// cannot widen its own reach. Every binding the main stack makes is on a resource one of these roles administers.
const DEPLOYER_ROLES = [
  // Creates and updates the services and jobs, sets their invoker bindings (run.services.setIamPolicy), and runs
  // the migrate job.
  'roles/run.admin',
  // Creates the probes queue and the api's enqueue binding on it (cloudtasks.queues.setIamPolicy).
  'roles/cloudtasks.admin',
  // Creates the dispatch and outbox drain jobs.
  'roles/cloudscheduler.admin',
  // Creates the repository and pushes the images into it.
  'roles/artifactregistry.admin',
  // Creates the log-based metric behind the alert.
  'roles/logging.configWriter',
  // Create the alert policy and its e-mail channel.
  'roles/monitoring.alertPolicyEditor',
  'roles/monitoring.notificationChannelEditor',
  // Lets Pulumi and gcloud bill API calls to the project.
  'roles/serviceusage.serviceUsageConsumer',
  // Reads the project (its number, for the service URLs); no other permission.
  'roles/browser',
];

// Deploying a revision, a scheduler job or a task token as a service account requires acting as it. The
// grant names each account, so the deployer cannot act as any other identity in the project.
function allowToActAs(grantName: string, target: gcp.serviceaccount.Account, actor: gcp.serviceaccount.Account): void {
  new gcp.serviceaccount.IAMMember(grantName, {
    serviceAccountId: target.name,
    role: SERVICE_ACCOUNT_USER_ROLE,
    member: memberOf(actor.email),
  });
}

export function grantDeployerAccess(config: BootstrapConfig, accounts: ServiceAccounts): void {
  for (const role of DEPLOYER_ROLES) {
    grantProjectRole(config.project, { name: `deployer-${role.replace('roles/', '').replaceAll('.', '-')}`, serviceAccountEmail: accounts.deployer.email, role });
  }

  allowToActAs('deployer-acts-as-api', accounts.api, accounts.deployer);
  allowToActAs('deployer-acts-as-worker', accounts.worker, accounts.deployer);
  allowToActAs('deployer-acts-as-demo-server', accounts.demoServer, accounts.deployer);
  allowToActAs('deployer-acts-as-scheduler', accounts.scheduler, accounts.deployer);

  // The api mints the OIDC tokens that Cloud Tasks presents to the worker, which requires acting as the tasks account.
  allowToActAs('api-acts-as-tasks', accounts.tasks, accounts.api);

  // Pulumi keeps its state and its lock files here.
  new gcp.storage.BucketIAMMember('state-bucket-deployer', {
    bucket: config.stateBucket,
    role: 'roles/storage.objectAdmin',
    member: memberOf(accounts.deployer.email),
  });
}
