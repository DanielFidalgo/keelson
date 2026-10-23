import * as pulumi from '@pulumi/pulumi';

export function memberOf(serviceAccountEmail: pulumi.Input<string>): pulumi.Output<string> {
  return pulumi.interpolate`serviceAccount:${serviceAccountEmail}`;
}
