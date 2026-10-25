<script setup lang="ts">
import { computed } from 'vue';
import { useLoadedData } from '../composables/useLoadedData.js';
import { useApiClient } from '../injection.js';

const props = defineProps<{ monitorId: string; hash: string | null }>();

const client = useApiClient();
const { data: snapshot, errorMessage } = useLoadedData(async () => (props.hash === null ? null : client.getSnapshot(props.monitorId, props.hash)));

const catalog = computed(() => snapshot.value?.catalog ?? null);
</script>

<template>
  <p v-if="hash === null" class="muted">No baseline yet. The first successful probe sets one.</p>
  <p v-else-if="errorMessage !== null" class="error" role="alert">{{ errorMessage }}</p>
  <p v-else-if="catalog === null" class="muted">Loading...</p>
  <div v-else class="snapshot">
    <!-- Names, descriptions and URIs come from the probed server, so they are only ever interpolated as text below. -->
    <section data-section="tools">
      <h2>Tools ({{ catalog.tools.length }})</h2>
      <p v-if="catalog.tools.length === 0" class="muted">No tools.</p>
      <ul v-else class="entries">
        <li v-for="tool in catalog.tools" :key="tool.name">
          <span class="mono entry-name">{{ tool.name }}</span>
          <p class="entry-description">{{ tool.description }}</p>
        </li>
      </ul>
    </section>
    <section data-section="prompts">
      <h2>Prompts ({{ catalog.prompts.length }})</h2>
      <p v-if="catalog.prompts.length === 0" class="muted">No prompts.</p>
      <ul v-else class="entries">
        <li v-for="prompt in catalog.prompts" :key="prompt.name">
          <span class="mono entry-name">{{ prompt.name }}</span>
          <p class="entry-description">{{ prompt.description }}</p>
        </li>
      </ul>
    </section>
    <section data-section="resources">
      <h2>Resources ({{ catalog.resources.length }})</h2>
      <p v-if="catalog.resources.length === 0" class="muted">No resources.</p>
      <ul v-else class="entries">
        <li v-for="resource in catalog.resources" :key="resource.uri">
          <span class="mono entry-name">{{ resource.uri }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.snapshot h2:first-child {
  margin-top: 0;
}

.entries {
  margin: 0;
  padding: 0;
  list-style: none;
}

.entries li {
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--scalar-background-2);
}

.entry-name {
  color: var(--scalar-color-1);
  overflow-wrap: anywhere;
}

.entry-description {
  margin: var(--space-1) 0 0;
  color: var(--scalar-color-2);
  overflow-wrap: anywhere;
}
</style>
