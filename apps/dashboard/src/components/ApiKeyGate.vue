<script setup lang="ts">
import { ref } from 'vue';
import { useApiKeyStore } from '../injection.js';

const apiKeyStore = useApiKeyStore();
const draft = ref('');

function submit(): void {
  const key = draft.value.trim();
  if (key === '') return;
  apiKeyStore.save(key);
  draft.value = '';
}
</script>

<template>
  <slot v-if="apiKeyStore.key.value !== null" />
  <div v-else class="key-gate">
    <form class="key-form" @submit.prevent="submit">
      <h1>Keelson</h1>
      <label>
        API key
        <input v-model="draft" class="input" type="password" autocomplete="off" required />
      </label>
      <button type="submit" class="btn btn-primary">Continue</button>
      <p class="hint">The key stays in this tab's session storage and is sent only to this server.</p>
    </form>
  </div>
</template>
