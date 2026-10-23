<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import ApiKeyGate from './components/ApiKeyGate.vue';
import { useApiKeyStore } from './injection.js';

const apiKeyStore = useApiKeyStore();
</script>

<template>
  <ApiKeyGate>
    <header class="app-header">
      <strong>Keelson</strong>
      <nav>
        <RouterLink to="/">Monitors</RouterLink>
        <RouterLink to="/incidents">Incidents</RouterLink>
      </nav>
      <button type="button" class="link-button" @click="apiKeyStore.clear()">Forget API key</button>
    </header>
    <main>
      <RouterView />
    </main>
  </ApiKeyGate>
</template>
