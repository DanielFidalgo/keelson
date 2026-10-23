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
        <span>{{ KIND_LABELS[change.kind] }}</span>
        <code>{{ subjectOf(change) }}</code>
      </div>
      <div v-if="change.kind === 'description_changed'" class="before-after">
        <div>
          <h4>Before</h4>
          <pre>{{ change.before }}</pre>
        </div>
        <div>
          <h4>After</h4>
          <pre>{{ change.after }}</pre>
        </div>
      </div>
    </li>
  </ul>
</template>
