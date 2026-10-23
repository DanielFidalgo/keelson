import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import type { BootstrapConfig } from './config';
import type { ServiceAccounts } from './service-accounts';

const GITHUB_REPOSITORY = 'DanielFidalgo/keelson';
const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const DEPLOY_BRANCH_REF = 'refs/heads/main';
const WORKLOAD_IDENTITY_USER_ROLE = 'roles/iam.workloadIdentityUser';

export interface CiIdentity {
  provider: gcp.iam.WorkloadIdentityPoolProvider;
}

function allowToImpersonate(grantName: string, account: gcp.serviceaccount.Account, member: pulumi.Input<string>): void {
  new gcp.serviceaccount.IAMMember(grantName, { serviceAccountId: account.name, role: WORKLOAD_IDENTITY_USER_ROLE, member });
}

export function createCiIdentity(config: BootstrapConfig, accounts: ServiceAccounts): CiIdentity {
  const pool = new gcp.iam.WorkloadIdentityPool('github-actions', {
    workloadIdentityPoolId: 'github-actions',
    displayName: 'GitHub Actions',
  });

  const provider = new gcp.iam.WorkloadIdentityPoolProvider('github', {
    workloadIdentityPoolId: pool.workloadIdentityPoolId,
    workloadIdentityPoolProviderId: 'github',
    displayName: 'GitHub',
    attributeMapping: {
      'google.subject': 'assertion.sub',
      'attribute.repository': 'assertion.repository',
      'attribute.ref': 'assertion.ref',
    },
    // Tokens from any other repository are refused here, before a service account is consulted. The numeric id
    // is checked as well, because a deleted repository's name can be claimed again by someone else.
    attributeCondition: `assertion.repository == '${GITHUB_REPOSITORY}' && assertion.repository_id == '${config.repositoryId}'`,
    oidc: { issuerUri: GITHUB_OIDC_ISSUER },
  });

  // Previews run code from pull request branches, so that identity is read-only. Only main may deploy.
  allowToImpersonate('preview-by-repository', accounts.preview, pulumi.interpolate`principalSet://iam.googleapis.com/${pool.name}/attribute.repository/${GITHUB_REPOSITORY}`);
  allowToImpersonate('deployer-by-main', accounts.deployer, pulumi.interpolate`principalSet://iam.googleapis.com/${pool.name}/attribute.ref/${DEPLOY_BRANCH_REF}`);

  return { provider };
}
