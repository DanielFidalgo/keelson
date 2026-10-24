import * as gcp from '@pulumi/gcp';
import type { DeployConfig } from './config';

const REPOSITORY_ID = 'keelson';
// Every deploy pushes three new images; keeping the last few per app holds storage inside the free 0.5 GB and still
// leaves earlier images to roll back to.
const IMAGES_KEPT_PER_APP = 3;
const DELETE_AFTER = '1d';

export type ImageApp = 'api' | 'worker' | 'demo-server';

export function createRegistry(config: DeployConfig): gcp.artifactregistry.Repository {
  return new gcp.artifactregistry.Repository(REPOSITORY_ID, {
    repositoryId: REPOSITORY_ID,
    location: config.region,
    format: 'DOCKER',
    description: 'Keelson container images, tagged with the commit they were built from',
    cleanupPolicyDryRun: false,
    // A KEEP policy wins over a DELETE one, so this deletes every image older than a day except the most recent per app.
    cleanupPolicies: [
      { id: 'delete-older-images', action: 'DELETE', condition: { tagState: 'ANY', olderThan: DELETE_AFTER } },
      { id: 'keep-recent-images', action: 'KEEP', mostRecentVersions: { keepCount: IMAGES_KEPT_PER_APP } },
    ],
  });
}

// The deploy script and workflow push to this same path, so a change here must change them too.
export function imageReference(config: DeployConfig, app: ImageApp): string {
  return `${config.region}-docker.pkg.dev/${config.project}/${REPOSITORY_ID}/${app}:${config.imageTag}`;
}
