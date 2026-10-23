import * as gcp from '@pulumi/gcp';
import type { DeployConfig } from './config';

const REPOSITORY_ID = 'keelson';

export type ImageApp = 'api' | 'worker' | 'demo-server';

export function createRegistry(config: DeployConfig): gcp.artifactregistry.Repository {
  return new gcp.artifactregistry.Repository(REPOSITORY_ID, {
    repositoryId: REPOSITORY_ID,
    location: config.region,
    format: 'DOCKER',
    description: 'Keelson container images, tagged with the commit they were built from',
  });
}

// The deploy script and workflow push to this same path, so a change here must change them too.
export function imageReference(config: DeployConfig, app: ImageApp): string {
  return `${config.region}-docker.pkg.dev/${config.project}/${REPOSITORY_ID}/${app}:${config.imageTag}`;
}
