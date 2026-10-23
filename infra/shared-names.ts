// Names both Pulumi programs must agree on: the bootstrap stack creates these identities, roles and
// secrets, and the main stack refers to them. One module keeps the two stacks from drifting apart.

export const SERVICE_ACCOUNT_IDS = {
  api: 'keelson-api',
  worker: 'keelson-worker',
  demoServer: 'keelson-demo-server',
  tasks: 'keelson-tasks',
  scheduler: 'keelson-scheduler',
  deployer: 'keelson-deployer',
  preview: 'keelson-preview',
} as const;

export function serviceAccountEmail(accountId: string, project: string): string {
  return `${accountId}@${project}.iam.gserviceaccount.com`;
}

export const DATABASE_URL_SECRET = 'database-url';
export const DEMO_ADMIN_TOKEN_SECRET = 'demo-admin-token';
