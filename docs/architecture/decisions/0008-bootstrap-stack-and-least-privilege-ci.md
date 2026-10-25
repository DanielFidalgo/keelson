# 0008. Keep identities and IAM out of the CI deploy

Status: accepted

## Context

A CI deployer that can manage IAM can grant itself anything, including owner. Early designs gave CI `projectIamAdmin`, then a conditioned version that could still self-grant secret access.

## Decision

A `bootstrap` Pulumi stack, applied by a person, owns service accounts, custom roles, secret containers and GitHub Workload Identity (pinned to the repository name and numeric id). The CI deployer gets only the roles to deploy services, queues, schedulers, registry and alerting, plus `actAs` on the runtime accounts. Pull requests preview as a read-only account; only `main` may deploy.

## Alternatives considered

- **CI manages its own IAM**: One stack, but privilege escalation from any compromised workflow.

## Consequences

- An IAM change needs a person to apply the bootstrap stack.
- The main stack makes no project-level IAM bindings, asserted by tests.
