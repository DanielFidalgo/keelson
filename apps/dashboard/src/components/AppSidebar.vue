<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useApiKeyStore } from '../injection.js';

defineProps<{ monitorCount: number | null; openIncidentCount: number | null; webhookCount: number | null }>();

const KEY_HINT_LENGTH = 4;

const apiKeyStore = useApiKeyStore();
const route = useRoute();
// Only the end of the key is ever shown, enough to tell keys apart without exposing it to a screen share.
const maskedKey = computed(() => (apiKeyStore.key.value === null ? '' : `••••${apiKeyStore.key.value.slice(-KEY_HINT_LENGTH)}`));
</script>

<template>
  <aside class="sidebar">
    <div class="brand"><span class="brand-mark" aria-hidden="true" />Keelson</div>
    <nav class="nav" aria-label="Main">
      <RouterLink to="/" class="nav-item" active-class="is-active">Overview</RouterLink>
      <!-- A monitor's page is a sibling route of the list, so the router alone would not mark Monitors active there. -->
      <RouterLink to="/monitors" class="nav-item" active-class="is-active" :class="{ 'is-active': route.name === 'monitor' }">
        Monitors<span v-if="monitorCount !== null" class="nav-count">{{ monitorCount }}</span>
      </RouterLink>
      <RouterLink to="/incidents" class="nav-item" active-class="is-active">
        Incidents<span v-if="openIncidentCount !== null && openIncidentCount > 0" class="nav-count is-attention">{{ openIncidentCount }} open</span>
      </RouterLink>
      <RouterLink to="/webhooks" class="nav-item" active-class="is-active">
        Webhooks<span v-if="webhookCount !== null" class="nav-count">{{ webhookCount }}</span>
      </RouterLink>
      <a class="nav-item" href="/reference/" target="_blank" rel="noopener">API reference<span aria-hidden="true">↗</span></a>
    </nav>
    <div class="sidebar-footer">
      <span class="sidebar-footer-label">API key</span>
      <span class="mono">{{ maskedKey }}</span>
      <button type="button" class="link-button" data-action="sign-out" @click="apiKeyStore.clear()">Sign out</button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 2px;
  width: 200px;
  height: 100vh;
  padding: var(--space-4) 10px;
  border-right: 1px solid var(--scalar-border-color);
  background: var(--scalar-background-1);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2) var(--space-4);
  font-weight: 600;
}

.brand-mark {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--brand-gradient);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px var(--space-2);
  border-radius: var(--radius);
  color: var(--scalar-color-2);
  transition: background-color 0.12s, color 0.12s;
}

.nav-item:hover {
  background: var(--scalar-background-2);
  color: var(--scalar-color-1);
  text-decoration: none;
}

.nav-item.is-active {
  background: var(--scalar-background-2);
  color: var(--scalar-color-1);
}

.nav-count {
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--scalar-background-3);
  color: var(--scalar-color-2);
  font-size: 11px;
}

.nav-count.is-attention {
  background: var(--status-critical-background);
  color: var(--scalar-color-orange);
}

.sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  margin-top: auto;
  padding: var(--space-3) var(--space-2) 0;
  border-top: 1px solid var(--scalar-border-color);
  color: var(--scalar-color-3);
  font-size: var(--font-size-small);
}
</style>
