<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import type { Monitor } from '../api/client.js';
import { describeProblems } from '../api/describe-failure.js';
import { useApiClient } from '../injection.js';
import { DEFAULT_INTERVAL_SECONDS } from '../intervals.js';
import IntervalSelect from './IntervalSelect.vue';
import ModalDialog from './ModalDialog.vue';

const emit = defineEmits<{ close: []; created: [monitor: Monitor] }>();

const client = useApiClient();
const formId = useId();

const name = ref('');
const url = ref('');
const intervalSeconds = ref(DEFAULT_INTERVAL_SECONDS);
const authSecret = ref('');
const sending = ref(false);
const problems = ref<string[]>([]);

const optionalAuthSecret = computed(() => (authSecret.value === '' ? {} : { authSecret: authSecret.value }));

async function submit(): Promise<void> {
  if (sending.value) return;
  sending.value = true;
  problems.value = [];
  try {
    const monitor = await client.createMonitor({
      name: name.value,
      url: url.value,
      intervalSeconds: intervalSeconds.value,
      ...optionalAuthSecret.value,
    });
    emit('created', monitor);
  } catch (failure) {
    problems.value = describeProblems(failure);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <ModalDialog title="Add monitor" @close="emit('close')">
    <!-- The API is the authority on what is valid, so its messages are shown instead of the browser's. -->
    <form :id="formId" class="monitor-form" novalidate @submit.prevent="submit">
      <label class="field">
        <span>Name</span>
        <input v-model="name" class="input" name="name" type="text" autocomplete="off" required data-autofocus />
      </label>
      <label class="field">
        <span>URL</span>
        <input v-model="url" class="input" name="url" type="url" autocomplete="off" placeholder="https://example.com/mcp" required />
      </label>
      <IntervalSelect v-model="intervalSeconds" />
      <label class="field">
        <span>Bearer token (optional)</span>
        <input v-model="authSecret" class="input" name="authSecret" type="password" autocomplete="off" />
      </label>
      <div v-if="problems.length > 0" class="error" role="alert">
        <ul class="problems">
          <li v-for="problem in problems" :key="problem">{{ problem }}</li>
        </ul>
      </div>
    </form>
    <template #footer>
      <button type="button" class="btn" data-action="cancel" @click="emit('close')">Cancel</button>
      <button type="submit" class="btn btn-primary" data-action="submit" :form="formId" :disabled="sending">Add monitor</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.monitor-form {
  display: grid;
  gap: var(--space-3);
}

.field {
  display: grid;
  gap: var(--space-1);
  color: var(--scalar-color-2);
}

.problems {
  margin: 0;
  padding-left: var(--space-4);
}
</style>
