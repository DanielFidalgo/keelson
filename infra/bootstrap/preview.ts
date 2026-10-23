import * as gcp from '@pulumi/gcp';
import { memberOf } from '../iam';
import type { BootstrapConfig } from './config';
import { grantProjectRole } from './project-roles';
import type { ServiceAccounts } from './service-accounts';

// Pulumi's lock files; the preview must create and delete them, and must not be able to alter state itself.
const LOCK_PREFIX = '.pulumi/locks/';

// Pull requests run branch code, so this identity can only read. It cannot see secret values, change a
// resource, or grant anything.
export function grantPreviewAccess(config: BootstrapConfig, accounts: ServiceAccounts): void {
  grantProjectRole(config.project, { name: 'preview-viewer', serviceAccountEmail: accounts.preview.email, role: 'roles/viewer' });
  grantProjectRole(config.project, { name: 'preview-usage', serviceAccountEmail: accounts.preview.email, role: 'roles/serviceusage.serviceUsageConsumer' });

  const previewMember = memberOf(accounts.preview.email);
  new gcp.storage.BucketIAMMember('state-bucket-preview-reader', { bucket: config.stateBucket, role: 'roles/storage.objectViewer', member: previewMember });
  new gcp.storage.BucketIAMMember('state-bucket-preview-locks', {
    bucket: config.stateBucket,
    role: 'roles/storage.objectUser',
    member: previewMember,
    condition: {
      title: 'only Pulumi lock files',
      expression: `resource.name.startsWith('projects/_/buckets/${config.stateBucket}/objects/${LOCK_PREFIX}')`,
    },
  });
}
