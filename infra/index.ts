import * as gcp from '@pulumi/gcp';
import { createRetriesExhaustedAlert } from './alerting';
import { loadDeployConfig } from './config';
import { createJobs } from './jobs';
import { createProbeQueue } from './queue';
import { createRegistry } from './registry';
import { createSchedulerJobs } from './scheduler';
import { referenceServiceAccounts } from './service-accounts';
import { deriveServiceUrls } from './service-urls';
import { createServices } from './services';

// The identities, secrets, custom roles and CI access this stack runs on come from the bootstrap stack
// (infra/bootstrap), which is applied once by a person; this stack is what CI applies on every deploy.
const config = loadDeployConfig(process.env);
const accounts = referenceServiceAccounts(config.project);
const projectNumber = gcp.organizations.getProjectOutput({ projectId: config.project }).number;
const urls = deriveServiceUrls(config, projectNumber);

createRegistry(config);
createProbeQueue(config.region, accounts);
createServices({ config, accounts, urls });
createJobs({ config, accounts, urls });
createSchedulerJobs(config.region, accounts, urls);
createRetriesExhaustedAlert(config.alertEmail);

export const apiUrl = urls.api;
export const workerUrl = urls.worker;
export const demoServerUrl = urls.demoServer;
