<script setup lang="ts">
import type { Change } from '../api/client.js';

defineProps<{ changes: Change[] }>();

const KIND_LABELS: Record<Change['kind'], string> = {
  tool_added: 'Tool added',
  tool_removed: 'Tool removed',
  prompt_added: 'Prompt added',
  prompt_removed: 'Prompt removed',
  resource_added: 'Resource added',
  resource_removed: 'Resource removed',
  input_schema_changed: 'Input schema changed',
  description_changed: 'Description changed',
};

const SEVERITY_LABELS: Record<Change['severity'], string> = { critical: 'Critical', warning: 'Warning' };

type TargetKind = 'tool' | 'prompt' | 'resource';

// A description change names its own target; every other kind is about one fixed kind of thing.
const TARGET_KINDS: Record<Exclude<Change['kind'], 'description_changed'>, TargetKind> = {
  tool_added: 'tool',
  tool_removed: 'tool',
  prompt_added: 'prompt',
  prompt_removed: 'prompt',
  resource_added: 'resource',
  resource_removed: 'resource',
  input_schema_changed: 'tool',
};

function targetKindOf(change: Change): TargetKind {
  return change.kind === 'description_changed' ? (change.target ?? 'tool') : TARGET_KINDS[change.kind];
}

// Names, URIs and descriptions come from the probed server, so they are only ever interpolated as text below.
function subjectOf(change: Change): string {
  return change.name ?? change.uri ?? change.tool ?? '';
}
</script>

<template>
  <p v-if="changes.length === 0">No changes.</p>
  <ul v-else class="changes">
    <li v-for="(change, index) in changes" :key="index" class="change" :data-severity="change.severity">
      <div class="change-heading">
        <span class="badge" :class="`badge-${change.severity}`">{{ SEVERITY_LABELS[change.severity] }}</span>
        <span v-if="change.classification === 'breaking'" class="badge badge-breaking">Breaking</span>
        <span v-else-if="change.classification === 'compatible'" class="badge">Compatible</span>
        <strong>{{ KIND_LABELS[change.kind] }}</strong>
        <span class="target mono muted">{{ targetKindOf(change) }} · {{ subjectOf(change) }}</span>
      </div>
      <div v-if="change.kind === 'description_changed'" class="diff mono">
        <span class="diff-line is-removed">- {{ change.before }}</span>
        <span class="diff-line is-added">+ {{ change.after }}</span>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.diff {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-2) 10px 10px;
  line-height: 1.6;
}

.diff-line {
  padding: 0 6px;
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.is-removed {
  background: var(--diff-removed-background);
  color: var(--diff-removed-color);
}

.is-added {
  background: var(--diff-added-background);
  color: var(--diff-added-color);
}
</style>
