import type { CanonicalCatalog, CanonicalPrompt, CanonicalResource, CanonicalTool } from '../snapshots/catalog.js';
import { compareCodeUnits } from '../snapshots/json.js';
import { classifySchemaChange } from './schema-change.js';
import type { SnapshotHash } from '../snapshots/snapshot.js';

export type Severity = 'critical' | 'warning';

export type Change =
  | { kind: 'tool_added' | 'tool_removed' | 'prompt_added' | 'prompt_removed'; name: string; severity: Severity }
  | { kind: 'resource_added' | 'resource_removed'; uri: string; severity: Severity }
  | { kind: 'input_schema_changed'; tool: string; classification: 'breaking' | 'compatible'; severity: Severity }
  | {
      kind: 'description_changed';
      target: 'tool' | 'prompt';
      name: string;
      before: string;
      after: string;
      severity: 'critical';
    };

type Described = { name: string; description: string };

export interface Drift {
  readonly id: string;
  readonly monitorId: string;
  readonly fromHash: SnapshotHash;
  readonly toHash: SnapshotHash;
  readonly changes: readonly Change[];
  readonly maxSeverity: Severity;
  readonly detectedAt: Date;
}

type Diff<T> = {
  identityOf: (item: T) => string;
  added: (item: T) => Change[];
  removed: (item: T) => Change[];
  kept: (before: T, after: T) => Change[];
};

export function computeChanges(baseline: CanonicalCatalog, current: CanonicalCatalog): Change[] {
  return [
    ...diffByIdentity(baseline.tools, current.tools, toolDiff),
    ...diffByIdentity(baseline.prompts, current.prompts, promptDiff),
    ...diffByIdentity(baseline.resources, current.resources, resourceDiff),
  ];
}

export function maxSeverity(changes: readonly Change[]): Severity | null {
  if (changes.length === 0) return null;
  return changes.some((change) => change.severity === 'critical') ? 'critical' : 'warning';
}

const toolDiff: Diff<CanonicalTool> = {
  identityOf: (tool) => tool.name,
  added: (tool) => [{ kind: 'tool_added', name: tool.name, severity: 'warning' }],
  removed: (tool) => [{ kind: 'tool_removed', name: tool.name, severity: 'critical' }],
  kept: (before, after) => [
    ...descriptionChanges('tool', before, after),
    ...inputSchemaChanges(before, after),
  ],
};

const promptDiff: Diff<CanonicalPrompt> = {
  identityOf: (prompt) => prompt.name,
  added: (prompt) => [{ kind: 'prompt_added', name: prompt.name, severity: 'warning' }],
  removed: (prompt) => [{ kind: 'prompt_removed', name: prompt.name, severity: 'critical' }],
  kept: (before, after) => descriptionChanges('prompt', before, after),
};

const resourceDiff: Diff<CanonicalResource> = {
  identityOf: (resource) => resource.uri,
  added: (resource) => [{ kind: 'resource_added', uri: resource.uri, severity: 'warning' }],
  removed: (resource) => [{ kind: 'resource_removed', uri: resource.uri, severity: 'critical' }],
  kept: () => [],
};

// Merging on a single sorted identity list keeps every change for one entry adjacent and the order deterministic.
function diffByIdentity<T>(before: readonly T[], after: readonly T[], diff: Diff<T>): Change[] {
  const beforeByIdentity = new Map(before.map((item) => [diff.identityOf(item), item]));
  const afterByIdentity = new Map(after.map((item) => [diff.identityOf(item), item]));
  const identities = [...new Set([...beforeByIdentity.keys(), ...afterByIdentity.keys()])].sort(compareCodeUnits);
  return identities.flatMap((identity) => {
    const previous = beforeByIdentity.get(identity);
    const next = afterByIdentity.get(identity);
    if (previous === undefined && next !== undefined) return diff.added(next);
    if (previous !== undefined && next === undefined) return diff.removed(previous);
    if (previous !== undefined && next !== undefined) return diff.kept(previous, next);
    return [];
  });
}

function descriptionChanges(target: 'tool' | 'prompt', before: Described, after: Described): Change[] {
  if (before.description === after.description) return [];
  return [
    {
      kind: 'description_changed',
      target,
      name: after.name,
      before: before.description,
      after: after.description,
      severity: 'critical',
    },
  ];
}

function inputSchemaChanges(before: CanonicalTool, after: CanonicalTool): Change[] {
  const classification = classifySchemaChange(before.inputSchema, after.inputSchema);
  if (classification === 'unchanged') return [];
  return [
    {
      kind: 'input_schema_changed',
      tool: after.name,
      classification,
      severity: classification === 'breaking' ? 'critical' : 'warning',
    },
  ];
}
