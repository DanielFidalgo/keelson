import * as pulumi from '@pulumi/pulumi';

export interface BootstrapConfig {
  project: string;
  // Numeric GitHub repository id. Unlike the name, it survives a deleted and re-created repository, so a
  // new repository that reuses the name cannot impersonate this one.
  repositoryId: string;
  stateBucket: string;
}

const NUMERIC_ID = /^\d+$/;

export function loadBootstrapConfig(): BootstrapConfig {
  const config = new pulumi.Config();
  const repositoryId = config.require('repositoryId');
  // The id is placed inside a condition expression, so anything but digits is refused.
  if (!NUMERIC_ID.test(repositoryId)) throw new Error('repositoryId must be the numeric GitHub repository id');
  return {
    project: new pulumi.Config('gcp').require('project'),
    repositoryId,
    stateBucket: config.require('stateBucket'),
  };
}
