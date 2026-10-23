import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import type { BootstrapConfig } from './config';
import { grantProjectRole, type IamCondition } from './project-roles';
import { SECRET_ACCESSOR_ROLE, type CustomRoles } from './roles';
import type { ServiceAccounts } from './service-accounts';

// Secrets the application creates at run time carry these prefixes (see the use cases in packages/application),
// which is what lets an IAM condition confine the api and worker to them.
const APPLICATION_SECRET_PREFIXES = ['monitor-', 'webhook-'];

// Resource names in IAM conditions use the project number, for secrets and for their versions alike.
function onlyApplicationSecrets(projectNumber: pulumi.Input<string>): IamCondition {
  const expression = pulumi
    .output(projectNumber)
    .apply((number) => APPLICATION_SECRET_PREFIXES.map((prefix) => `resource.name.startsWith("projects/${number}/secrets/${prefix}")`).join(' || '));
  return { title: 'only monitor and webhook secrets', expression };
}

// The api stores a secret per monitor credential and webhook signing key, and the worker reads them. The grants
// cover those secrets only, so neither identity can touch database-url or any other secret. They live in this
// stack, not the main one, because whoever can edit project IAM could drop the condition or widen the role.
export function grantApplicationSecretAccess(config: BootstrapConfig, accounts: ServiceAccounts, roles: CustomRoles): void {
  const projectNumber = gcp.organizations.getProjectOutput({ projectId: config.project }).number;
  const condition = onlyApplicationSecrets(projectNumber);

  // Creating a secret is checked against the project, not against the secret that does not exist yet, so no
  // name condition can apply to it. The role holds that one permission and nothing else.
  grantProjectRole(config.project, { name: 'api-secret-creator', serviceAccountEmail: accounts.api.email, role: roles.secretCreator.name });
  grantProjectRole(config.project, { name: 'api-application-secrets', serviceAccountEmail: accounts.api.email, role: roles.secretDataManager.name, condition });
  grantProjectRole(config.project, { name: 'worker-application-secrets', serviceAccountEmail: accounts.worker.email, role: SECRET_ACCESSOR_ROLE, condition });
}
