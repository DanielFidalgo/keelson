import * as pulumi from '@pulumi/pulumi';
import { serviceAccountEmail } from './shared-names';

export const PROJECT = 'fidalgo-tech';
export const REGION = 'us-central1';
export const PROJECT_NUMBER = '123456789012';

export interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

export interface MemberInputs {
  name: string;
  role: string;
  member: string;
  condition?: { title: string; expression: string };
}

function derivedState(type: string, inputs: Record<string, unknown>): Record<string, unknown> {
  if (type === 'gcp:serviceaccount/account:Account') {
    const email = serviceAccountEmail(String(inputs['accountId']), PROJECT);
    return { email, name: `projects/${PROJECT}/serviceAccounts/${email}` };
  }
  if (type === 'gcp:iam/workloadIdentityPool:WorkloadIdentityPool') {
    return { name: `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${String(inputs['workloadIdentityPoolId'])}` };
  }
  if (type === 'gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider') {
    return { name: `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/providers/${String(inputs['workloadIdentityPoolProviderId'])}` };
  }
  if (type === 'gcp:projects/iAMCustomRole:IAMCustomRole') return { name: `projects/${PROJECT}/roles/${String(inputs['roleId'])}` };
  if (type === 'gcp:monitoring/notificationChannel:NotificationChannel') {
    return { name: `projects/${PROJECT}/notificationChannels/channel-1` };
  }
  return {};
}

// Runs a Pulumi program against mocked resources and returns everything it registered. Resources register
// asynchronously, so the recording is complete only once every outstanding registration has drained.
export interface ProgramRun {
  // Config keys are namespaced by the Pulumi project name, so the run has to impersonate it.
  projectName: string;
  stackConfig: Record<string, string>;
}

export async function recordProgram({ projectName, stackConfig }: ProgramRun, loadProgram: () => Promise<unknown>): Promise<RecordedResource[]> {
  const recorded: RecordedResource[] = [];
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        const inputs = args.inputs as Record<string, unknown>;
        recorded.push({ type: args.type, name: args.name, inputs });
        return { id: `${args.name}-id`, state: { ...inputs, ...derivedState(args.type, inputs) } };
      },
      call: (args) => {
        if (args.token === 'gcp:organizations/getProject:getProject') return { projectId: PROJECT, number: PROJECT_NUMBER };
        return args.inputs as Record<string, unknown>;
      },
    },
    projectName,
    'test',
    false,
  );
  pulumi.runtime.setAllConfig({ 'gcp:project': PROJECT, 'gcp:region': REGION, ...stackConfig });
  await loadProgram();
  await pulumi.runtime.disconnect();
  return recorded;
}

export function resourcesOfType(recorded: RecordedResource[], type: string): RecordedResource[] {
  return recorded.filter((resource) => resource.type === type);
}

export function memberInputsOf(resource: RecordedResource): MemberInputs {
  return resource.inputs as unknown as MemberInputs;
}

export function serviceAccountMember(accountId: string): string {
  return `serviceAccount:${serviceAccountEmail(accountId, PROJECT)}`;
}

export function projectRoleGrants(recorded: RecordedResource[]): MemberInputs[] {
  return resourcesOfType(recorded, 'gcp:projects/iAMMember:IAMMember').map(memberInputsOf);
}
