<script setup lang="ts">
import { computed, ref } from 'vue';
import { describeFailure } from '../api/describe-failure.js';
import { useLoadedData } from '../composables/useLoadedData.js';
import { useApiClient } from '../injection.js';
import ModalDialog from './ModalDialog.vue';

const props = defineProps<{ monitorId: string; monitorName: string }>();

const emit = defineEmits<{ close: []; approved: [] }>();

const client = useApiClient();
const { data: current, errorMessage: loadError } = useLoadedData(() => client.getDrift(props.monitorId));
const approving = ref(false);
const approveError = ref<string | null>(null);

// `drift` is null both for a monitor that matches its baseline and while loading, so loading is told apart by `current`.
const drift = computed(() => current.value?.drift ?? null);
const loaded = computed(() => current.value !== null || loadError.value !== null);
const changeCount = computed(() => drift.value?.changes.length ?? 0);
const highestSeverityLabel = computed(() => {
  const severities = drift.value?.changes.map((change) => change.severity) ?? [];
  if (severities.includes('critical')) return 'Critical';
  return severities.includes('warning') ? 'Warning' : 'None';
});

async function approve(): Promise<void> {
  if (drift.value === null || approving.value) return;
  approving.value = true;
  approveError.value = null;
  try {
    // The hash that was shown is the one approved, even if the monitor has drifted again since it was read.
    await client.approveBaseline(props.monitorId, drift.value.toHash);
    emit('approved');
  } catch (failure) {
    approveError.value = describeFailure(failure);
  } finally {
    approving.value = false;
  }
}
</script>

<template>
  <ModalDialog title="Approve new baseline" @close="emit('close')">
    <p class="subject">{{ monitorName }}</p>
    <p v-if="loadError !== null" class="error" role="alert">{{ loadError }}</p>
    <p v-else-if="!loaded" class="muted">Reading the current drift...</p>
    <p v-else-if="drift === null">No drift to approve. The monitor already matches its approved baseline.</p>
    <template v-else>
      <dl class="summary">
        <dt>Changes</dt>
        <dd data-field="changes">{{ changeCount }} {{ changeCount === 1 ? 'change' : 'changes' }}</dd>
        <dt>Highest severity</dt>
        <dd data-field="severity">{{ highestSeverityLabel }}</dd>
        <dt>New baseline</dt>
        <dd class="mono" data-field="hash">{{ drift.toHash }}</dd>
      </dl>
      <p class="hint">Approving makes this snapshot the baseline future probes are compared with.</p>
    </template>
    <p v-if="approveError !== null" class="error" role="alert">{{ approveError }}</p>
    <template #footer>
      <button type="button" class="btn" data-action="cancel" @click="emit('close')">Cancel</button>
      <button type="button" class="btn btn-primary" data-action="approve" :disabled="drift === null || approving" @click="approve">Approve baseline</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.subject {
  margin: 0 0 var(--space-3);
  color: var(--scalar-color-1);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.summary {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-1) var(--space-4);
  margin: 0 0 var(--space-3);
}

.summary dt {
  color: var(--scalar-color-3);
}

.summary dd {
  margin: 0;
  color: var(--scalar-color-1);
  overflow-wrap: anywhere;
}
</style>
