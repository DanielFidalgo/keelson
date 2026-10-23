import * as gcp from '@pulumi/gcp';

export const SECRET_ACCESSOR_ROLE = 'roles/secretmanager.secretAccessor';

export interface CustomRoles {
  secretCreator: gcp.projects.IAMCustomRole;
  secretDataManager: gcp.projects.IAMCustomRole;
  logMetricsManager: gcp.projects.IAMCustomRole;
}

// Defining roles needs roles/iam.roleAdmin, which only a person holds; the deployer cannot define or grant roles.
export function createCustomRoles(): CustomRoles {
  return {
    // Creating a secret is authorised against the project, not the new secret, so it cannot be limited by name
    // and must not share a role with anything else.
    secretCreator: new gcp.projects.IAMCustomRole('secret-creator', {
      roleId: 'keelsonSecretCreator',
      title: 'Keelson secret creator',
      permissions: ['secretmanager.secrets.create'],
    }),
    // Granted only under a condition on the secret name (see application-secrets.ts).
    secretDataManager: new gcp.projects.IAMCustomRole('secret-data-manager', {
      roleId: 'keelsonSecretDataManager',
      title: 'Keelson secret data manager',
      permissions: ['secretmanager.secrets.get', 'secretmanager.secrets.delete', 'secretmanager.versions.add', 'secretmanager.versions.access'],
    }),
    // roles/logging.configWriter would also let the deployer create log sinks and exclusions, which can drop the very
    // log lines the probe-failure alert counts. Managing the one log-based metric needs only these five.
    logMetricsManager: new gcp.projects.IAMCustomRole('log-metrics-manager', {
      roleId: 'keelsonLogMetricsManager',
      title: 'Keelson log metrics manager',
      permissions: ['logging.logMetrics.create', 'logging.logMetrics.get', 'logging.logMetrics.list', 'logging.logMetrics.update', 'logging.logMetrics.delete'],
    }),
  };
}
