<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Monitor, UpdateMonitorRequest } from '../api/client.js';
import IntervalSelect from './IntervalSelect.vue';

const props = defineProps<{ monitor: Monitor; busy: boolean }>();

const emit = defineEmits<{ save: [changes: UpdateMonitorRequest]; delete: [] }>();

const name = ref(props.monitor.name);
const intervalSeconds = ref(props.monitor.intervalSeconds);
const newAuthSecret = ref('');
const clearAuthSecret = ref(false);

// Clearing wins over a replacement that was typed first, so what the checkbox says is what happens.
const authSecretChange = computed<UpdateMonitorRequest>(() => {
  if (clearAuthSecret.value) return { authSecret: null };
  return newAuthSecret.value === '' ? {} : { authSecret: newAuthSecret.value };
});

// Only what differs is sent, so an untouched field is never rewritten.
const changes = computed<UpdateMonitorRequest>(() => ({
  ...(name.value.trim() === props.monitor.name ? {} : { name: name.value.trim() }),
  ...(intervalSeconds.value === props.monitor.intervalSeconds ? {} : { intervalSeconds: intervalSeconds.value }),
  ...authSecretChange.value,
}));

const canSave = computed(() => !props.busy && Object.keys(changes.value).length > 0);

function save(): void {
  if (canSave.value) emit('save', changes.value);
}
</script>

<template>
  <form class="settings-form" novalidate @submit.prevent="save">
    <label class="field">
      <span>Name</span>
      <input v-model="name" class="input" name="name" type="text" autocomplete="off" required />
    </label>
    <IntervalSelect v-model="intervalSeconds" />
    <label class="field">
      <span>Bearer token</span>
      <input v-model="newAuthSecret" class="input" name="authSecret" type="password" autocomplete="off" :disabled="clearAuthSecret" />
      <span class="hint">{{ monitor.hasAuthSecret ? 'A token is stored. Type a new one to replace it, or leave this empty to keep it.' : 'No token is stored.' }}</span>
    </label>
    <label v-if="monitor.hasAuthSecret" class="checkbox">
      <input v-model="clearAuthSecret" name="clearAuthSecret" type="checkbox" />
      <span>Remove the stored token</span>
    </label>
    <div>
      <button type="submit" class="btn btn-primary" data-action="save" :disabled="!canSave">Save changes</button>
    </div>
  </form>
  <section class="danger-zone">
    <h2>Delete this monitor</h2>
    <p class="hint">Removes the monitor and its probe history. This cannot be undone.</p>
    <button type="button" class="btn btn-danger" data-action="delete" :disabled="busy" @click="emit('delete')">Delete monitor</button>
  </section>
</template>

<style scoped>
.settings-form {
  display: grid;
  gap: var(--space-3);
  max-width: 440px;
}

.field {
  display: grid;
  gap: var(--space-1);
  color: var(--scalar-color-2);
}

.checkbox {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  color: var(--scalar-color-2);
}

.danger-zone {
  max-width: 440px;
  margin-top: var(--space-6);
  padding-top: var(--space-2);
  border-top: 1px solid var(--scalar-border-color);
}

.danger-zone .hint {
  margin-bottom: var(--space-3);
}
</style>
