import * as pulumi from '@pulumi/pulumi';
import type { DeployConfig } from './config';

export const API_SERVICE = 'keelson-api';
export const WORKER_SERVICE = 'keelson-worker';
export const DEMO_SERVER_SERVICE = 'keelson-demo-server';

export interface ServiceUrls {
  api: pulumi.Output<string>;
  worker: pulumi.Output<string>;
  demoServer: pulumi.Output<string>;
}

// A service cannot read its own output URL while it is being created, because the URL depends on the service.
// Cloud Run's deterministic URL format is known up front, so the services can be wired to each other and to themselves.
export function deriveServiceUrls(config: DeployConfig, projectNumber: pulumi.Input<string>): ServiceUrls {
  const urlOf = (serviceName: string): pulumi.Output<string> => pulumi.interpolate`https://${serviceName}-${projectNumber}.${config.region}.run.app`;
  return { api: urlOf(API_SERVICE), worker: urlOf(WORKER_SERVICE), demoServer: urlOf(DEMO_SERVER_SERVICE) };
}
