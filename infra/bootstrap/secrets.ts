import * as gcp from '@pulumi/gcp';
import { memberOf } from '../iam';
import { DATABASE_URL_SECRET, DEMO_ADMIN_TOKEN_SECRET } from '../shared-names';
import { SECRET_ACCESSOR_ROLE } from './roles';
import type { ServiceAccounts } from './service-accounts';

// Pulumi creates only the containers: a version created here would put the plaintext into Pulumi state.
// Values are added by hand with `gcloud secrets versions add`.
function createSecretContainer(secretId: string): gcp.secretmanager.Secret {
  return new gcp.secretmanager.Secret(secretId, { secretId, replication: { auto: {} } });
}

function allowToRead(secret: gcp.secretmanager.Secret, grantName: string, account: gcp.serviceaccount.Account): void {
  new gcp.secretmanager.SecretIamMember(grantName, { secretId: secret.secretId, role: SECRET_ACCESSOR_ROLE, member: memberOf(account.email) });
}

// Each fixed secret is readable by the services that use it and by nobody else; Cloud Run resolves the
// reference with the service's own identity when a revision starts.
export function createSecrets(accounts: ServiceAccounts): void {
  const databaseUrl = createSecretContainer(DATABASE_URL_SECRET);
  allowToRead(databaseUrl, 'database-url-api', accounts.api);
  allowToRead(databaseUrl, 'database-url-worker', accounts.worker);

  const demoAdminToken = createSecretContainer(DEMO_ADMIN_TOKEN_SECRET);
  allowToRead(demoAdminToken, 'demo-admin-token-demo-server', accounts.demoServer);
}
