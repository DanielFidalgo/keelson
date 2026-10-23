import * as gcp from '@pulumi/gcp';
import type * as pulumi from '@pulumi/pulumi';
import { memberOf } from '../iam';

export interface IamCondition {
  title: string;
  expression: pulumi.Input<string>;
}

export interface ProjectRoleGrant {
  // Pulumi needs a unique logical name per binding, so the caller names the grant after what it is for.
  name: string;
  serviceAccountEmail: pulumi.Input<string>;
  role: pulumi.Input<string>;
  condition?: IamCondition;
}

// Project-level bindings are made only by this stack: the CI deployer holds no right to change project IAM.
export function grantProjectRole(project: string, { name, serviceAccountEmail, role, condition }: ProjectRoleGrant): gcp.projects.IAMMember {
  return new gcp.projects.IAMMember(name, {
    project,
    role,
    member: memberOf(serviceAccountEmail),
    ...(condition === undefined ? {} : { condition }),
  });
}
