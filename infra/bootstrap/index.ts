import { grantApplicationSecretAccess } from './application-secrets';
import { createCiIdentity } from './ci-identity';
import { loadBootstrapConfig } from './config';
import { grantDeployerAccess } from './deployer';
import { grantPreviewAccess } from './preview';
import { createCustomRoles } from './roles';
import { createSecrets } from './secrets';
import { createServiceAccounts } from './service-accounts';

// Everything here is the part of the setup that could be used to widen access: identities, roles and the trust
// in GitHub. A person applies it from a laptop (see scripts/deploy.sh); the CI identity has no right to change it.
const config = loadBootstrapConfig();
const accounts = createServiceAccounts();

const roles = createCustomRoles();
createSecrets(accounts);
grantApplicationSecretAccess(config, accounts, roles);
grantDeployerAccess(config, accounts, roles);
grantPreviewAccess(config, accounts);
const ciIdentity = createCiIdentity(config, accounts);

export const workloadIdentityProvider = ciIdentity.provider.name;
export const deployerServiceAccount = accounts.deployer.email;
export const previewServiceAccount = accounts.preview.email;
