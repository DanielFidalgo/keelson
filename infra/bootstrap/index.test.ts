import { beforeAll, describe, expect, it } from 'vitest';
import {
  PROJECT,
  PROJECT_NUMBER,
  memberInputsOf,
  projectRoleGrants,
  recordProgram,
  resourcesOfType,
  serviceAccountMember,
  type RecordedResource,
} from '../test-support';

const REPOSITORY_ID = '987654321';
const STATE_BUCKET = 'keelson-test-state';
const POOL_PATH = `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions`;
// Pinned in full: a role added to the deployer must show up here as a deliberate change. None of these can edit
// project IAM, define roles or read a secret's value. logging.configWriter is left out on purpose, because it also
// lets its holder create log sinks and exclusions, which could silence the probe-failure alert.
const DEPLOYER_ROLES = [
  'roles/run.admin',
  'roles/cloudtasks.admin',
  'roles/cloudscheduler.admin',
  'roles/artifactregistry.admin',
  `projects/${PROJECT}/roles/keelsonLogMetricsManager`,
  'roles/monitoring.alertPolicyEditor',
  'roles/monitoring.notificationChannelEditor',
  'roles/serviceusage.serviceUsageConsumer',
];
const SECRET_NAME_CONDITION = `resource.name.startsWith("projects/${PROJECT_NUMBER}/secrets/monitor-") || resource.name.startsWith("projects/${PROJECT_NUMBER}/secrets/webhook-")`;

let recorded: RecordedResource[] = [];
let programOutputs: Record<string, unknown> = {};

function ofType(type: string): RecordedResource[] {
  return resourcesOfType(recorded, type);
}

function grantsTo(accountId: string) {
  return projectRoleGrants(recorded).filter((grant) => grant.member === serviceAccountMember(accountId));
}

beforeAll(async () => {
  recorded = await recordProgram(
    { projectName: 'keelson-bootstrap', stackConfig: { 'keelson-bootstrap:repositoryId': REPOSITORY_ID, 'keelson-bootstrap:stateBucket': STATE_BUCKET } },
    async () => {
      programOutputs = await import('./index.js');
    },
  );
});

describe('Keelson bootstrap stack', () => {
  it('the CI workload identity provider only accepts the repository DanielFidalgo/keelson and its numeric id', () => {
    const [provider] = ofType('gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider');

    expect(provider?.inputs['attributeCondition']).toBe(
      `assertion.repository == 'DanielFidalgo/keelson' && assertion.repository_id == '${REPOSITORY_ID}'`,
    );
    expect(provider?.inputs['oidc']).toEqual({ issuerUri: 'https://token.actions.githubusercontent.com' });
  });

  it('lets only main impersonate the deployer, and any ref of the repository impersonate the preview account', () => {
    const impersonations = ofType('gcp:serviceaccount/iAMMember:IAMMember')
      .map(memberInputsOf)
      .filter((grant) => grant.role === 'roles/iam.workloadIdentityUser');

    expect(impersonations.map((grant) => grant.member).sort()).toEqual(
      [
        `principalSet://iam.googleapis.com/${POOL_PATH}/attribute.ref/refs/heads/main`,
        `principalSet://iam.googleapis.com/${POOL_PATH}/attribute.repository/DanielFidalgo/keelson`,
      ].sort(),
    );
  });

  it('gives the deployer exactly these project roles and no conditional or other custom ones', () => {
    const grants = grantsTo('keelson-deployer');

    expect(grants.map((grant) => grant.role).sort()).toEqual([...DEPLOYER_ROLES].sort());
    expect(grants.every((grant) => grant.condition === undefined)).toBe(true);
  });

  it('defines the log metrics role with only the five log-based metric permissions', () => {
    const role = ofType('gcp:projects/iAMCustomRole:IAMCustomRole').find((candidate) => candidate.inputs['roleId'] === 'keelsonLogMetricsManager');

    expect(role?.inputs['permissions']).toEqual([
      'logging.logMetrics.create',
      'logging.logMetrics.get',
      'logging.logMetrics.list',
      'logging.logMetrics.update',
      'logging.logMetrics.delete',
    ]);
  });

  it('lets the deployer act only as the runtime accounts it deploys, and the api act as the tasks account', () => {
    const actAs = ofType('gcp:serviceaccount/iAMMember:IAMMember')
      .map((resource) => resource.inputs as unknown as { role: string; member: string; serviceAccountId: string })
      .filter((grant) => grant.role === 'roles/iam.serviceAccountUser')
      .map((grant) => `${grant.member} acts as ${grant.serviceAccountId.split('/').pop() ?? ''}`);
    const emailOf = (accountId: string): string => `${accountId}@${PROJECT}.iam.gserviceaccount.com`;
    const deployer = serviceAccountMember('keelson-deployer');

    expect(actAs.sort()).toEqual(
      [
        `${deployer} acts as ${emailOf('keelson-api')}`,
        `${deployer} acts as ${emailOf('keelson-worker')}`,
        `${deployer} acts as ${emailOf('keelson-demo-server')}`,
        `${deployer} acts as ${emailOf('keelson-scheduler')}`,
        `${serviceAccountMember('keelson-api')} acts as ${emailOf('keelson-tasks')}`,
      ].sort(),
    );
  });

  it('keeps the preview account read-only', () => {
    const roles = grantsTo('keelson-preview').map((grant) => grant.role).sort();

    expect(roles).toEqual(['roles/serviceusage.serviceUsageConsumer', 'roles/viewer']);
  });

  it('lets the preview account write only Pulumi lock files in the state bucket', () => {
    const bucketGrants = ofType('gcp:storage/bucketIAMMember:BucketIAMMember').map((resource) => resource.inputs as unknown as { member: string; role: string; condition?: { expression: string } });
    const preview = bucketGrants.filter((grant) => grant.member === serviceAccountMember('keelson-preview'));

    expect(preview.map((grant) => grant.role).sort()).toEqual(['roles/storage.objectUser', 'roles/storage.objectViewer']);
    expect(preview.find((grant) => grant.role === 'roles/storage.objectUser')?.condition?.expression).toBe(
      `resource.name.startsWith('projects/_/buckets/${STATE_BUCKET}/objects/.pulumi/locks/')`,
    );
  });

  it('defines the secret creator role with the single permission to create secrets', () => {
    const role = ofType('gcp:projects/iAMCustomRole:IAMCustomRole').find((candidate) => candidate.inputs['roleId'] === 'keelsonSecretCreator');

    expect(role?.inputs['permissions']).toEqual(['secretmanager.secrets.create']);
  });

  it('confines the api and worker to monitor and webhook secrets with name conditions, never database-url', () => {
    const conditional = projectRoleGrants(recorded).filter((grant) => grant.condition !== undefined);

    const summaries = conditional.map((grant) => `${grant.member} ${grant.role} ${grant.condition?.expression ?? ''}`);

    expect(summaries.sort()).toEqual(
      [
        `${serviceAccountMember('keelson-api')} projects/${PROJECT}/roles/keelsonSecretDataManager ${SECRET_NAME_CONDITION}`,
        `${serviceAccountMember('keelson-worker')} roles/secretmanager.secretAccessor ${SECRET_NAME_CONDITION}`,
      ].sort(),
    );
    expect(JSON.stringify(projectRoleGrants(recorded))).not.toContain('database-url');
  });

  it('lets the api create secrets through a role with no other permission, unconditioned', () => {
    const creators = projectRoleGrants(recorded).filter((grant) => grant.role === `projects/${PROJECT}/roles/keelsonSecretCreator`);

    expect(creators).toEqual([expect.objectContaining({ member: serviceAccountMember('keelson-api') })]);
    expect(creators[0]?.condition).toBeUndefined();
  });

  it('creates the secret containers but never secret versions', () => {
    expect(ofType('gcp:secretmanager/secret:Secret').map((secret) => secret.inputs['secretId']).sort()).toEqual(['database-url', 'demo-admin-token']);
    expect(ofType('gcp:secretmanager/secretVersion:SecretVersion')).toEqual([]);
  });

  it('lets only the api and worker read database-url and only the demo server read demo-admin-token', () => {
    const readers = ofType('gcp:secretmanager/secretIamMember:SecretIamMember').map((resource) => resource.inputs as unknown as { secretId: string; member: string; role: string });
    const readersOf = (secretId: string): string[] => readers.filter((reader) => reader.secretId === secretId).map((reader) => reader.member).sort();

    expect(readersOf('database-url')).toEqual([serviceAccountMember('keelson-api'), serviceAccountMember('keelson-worker')].sort());
    expect(readersOf('demo-admin-token')).toEqual([serviceAccountMember('keelson-demo-server')]);
    expect(readers.every((reader) => reader.role === 'roles/secretmanager.secretAccessor')).toBe(true);
  });

  it('never grants owner or editor to anyone', () => {
    const roles = projectRoleGrants(recorded).map((grant) => grant.role);

    expect(roles).not.toContain('roles/owner');
    expect(roles).not.toContain('roles/editor');
  });

  it('exports what the workflows need to authenticate', () => {
    expect(Object.keys(programOutputs).sort()).toEqual(['deployerServiceAccount', 'previewServiceAccount', 'workloadIdentityProvider']);
  });
});
