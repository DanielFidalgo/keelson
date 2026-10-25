<script setup lang="ts">
import { provide, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { REFRESH_MS } from '../composables/useListQuery.js';
import { createNavCounts, navCountsKey } from '../composables/useNavCounts.js';
import { useVisibleInterval } from '../composables/useVisibleInterval.js';
import { useApiClient } from '../injection.js';
import AppSidebar from './AppSidebar.vue';

const navCounts = createNavCounts(useApiClient());
provide(navCountsKey, navCounts);

const route = useRoute();
watch(
  () => route.path,
  () => {
    void navCounts.refresh();
  },
  { immediate: true },
);
useVisibleInterval(() => {
  void navCounts.refresh();
}, REFRESH_MS);
</script>

<template>
  <div class="app-shell">
    <AppSidebar :monitor-count="navCounts.monitorCount.value" :open-incident-count="navCounts.openIncidentCount.value" :webhook-count="navCounts.webhookCount.value" />
    <!-- Keyed by path so a page that loads once, or a list keyed to its route, starts over when only the id in the path changes. -->
    <main class="app-main"><RouterView :key="route.path" /></main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100vh;
}

.app-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
</style>
