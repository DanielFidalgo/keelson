import * as pulumi from '@pulumi/pulumi';

export interface DeployConfig {
  project: string;
  region: string;
  imageTag: string;
  alertEmail: string;
}

const ALERT_EMAIL_VARIABLE = 'ALERT_NOTIFICATION_EMAIL';

// The address is read from the environment, not from stack config, so it never lands in a committed file.
export function loadDeployConfig(environment: NodeJS.ProcessEnv): DeployConfig {
  const google = new pulumi.Config('gcp');
  const keelson = new pulumi.Config('keelson');
  const alertEmail = environment[ALERT_EMAIL_VARIABLE];
  if (alertEmail === undefined || alertEmail === '') throw new Error(`${ALERT_EMAIL_VARIABLE} must be set`);
  return {
    project: google.require('project'),
    region: google.require('region'),
    imageTag: keelson.require('imageTag'),
    alertEmail,
  };
}
