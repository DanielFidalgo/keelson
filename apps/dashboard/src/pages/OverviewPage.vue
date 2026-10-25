<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { RouterLink } from 'vue-router';
import DataList from '../components/DataList.vue';
import ErrorBanner from '../components/ErrorBanner.vue';
import IncidentState from '../components/IncidentState.vue';
import PageHeader from '../components/PageHeader.vue';
import RelativeTime from '../components/RelativeTime.vue';
import StatusPill from '../components/StatusPill.vue';
import type { HealthCounts, IncidentView, MonitorWithSummary } from '../api/client.js';
import { describeFailure } from '../api/describe-failure.js';
import { REFRESH_MS } from '../composables/useListQuery.js';
import { useVisibleInterval } from '../composables/useVisibleInterval.js';
import { useApiClient } from '../injection.js';

interface Overview {
  counts: HealthCounts;
  incidents: IncidentView[];
  attention: MonitorWithSummary[];
}

const OPEN_INCIDENT_LIMIT = 5;
const ATTENTION_LIMIT = 10;
const COUNTERS = [
  ['monitors', 'Monitors', null],
  ['up', 'Up', 'up'],
  ['drift', 'Drifted', 'drift'],
  ['down', 'Down', 'down'],
] as const;
const INCIDENT_COLUMNS = ['Monitor', 'Kind', 'Opened', 'State'];
const ATTENTION_COLUMNS = ['Monitor', 'Status', 'Last probe'];

const client = useApiClient();

const overview = shallowRef<Overview | null>(null);
const error = ref<string | null>(null);
let latestRequest = 0;

async function load(): Promise<void> {
  const request = ++latestRequest;
  try {
    // Only down and drifted monitors are listed: a single failed probe is not yet a problem (see the monitor health rule).
    const [counts, incidents, down, drift] = await Promise.all([
      client.getHealthCounts(),
      client.listIncidents({ state: 'open', limit: OPEN_INCIDENT_LIMIT }),
      client.listMonitors({ health: 'down', limit: ATTENTION_LIMIT }),
      client.listMonitors({ health: 'drift', limit: ATTENTION_LIMIT }),
    ]);
    if (request !== latestRequest) return;
    overview.value = { counts, incidents: incidents.items, attention: [...down.items, ...drift.items] };
    error.value = null;
  } catch (failure) {
    if (request !== latestRequest) return;
    // The last good data stays: a failed minute-by-minute refresh should not blank a page the user is reading.
    error.value = describeFailure(failure);
  }
}

const loading = computed(() => overview.value === null && error.value === null);

useVisibleInterval(() => {
  void load();
}, REFRESH_MS);
void load();
</script>

<template>
  <PageHeader title="Overview" />
  <ErrorBanner v-if="error !== null" :message="`Could not load the overview: ${error}`" :showing-previous="overview !== null" @retry="load()" />
  <template v-if="overview !== null || error === null">
    <div v-if="overview !== null" class="counters">
      <RouterLink v-for="[name, label, health] in COUNTERS" :key="name" class="counter" :data-counter="name" :to="{ name: 'monitors', query: health === null ? {} : { health } }">
        <span class="muted">{{ label }}</span>
        <b>{{ overview.counts[name === 'monitors' ? 'total' : name] }}</b>
      </RouterLink>
    </div>
    <div class="section-heading">
      <h2>Open incidents</h2>
      <RouterLink to="/incidents">View all</RouterLink>
    </div>
    <DataList :columns="INCIDENT_COLUMNS" :loading="loading" :error="null" :is-empty="(overview?.incidents.length ?? 0) === 0" empty-title="No open incidents">
      <tr v-for="incident in overview?.incidents" :key="incident.id" data-incident>
        <td>
          <RouterLink class="cell-primary" :to="{ name: 'monitor', params: { id: incident.monitorId } }">{{ incident.monitorName }}</RouterLink>
        </td>
        <td><StatusPill :health="incident.kind" :severity="incident.severity" /></td>
        <td class="text-secondary"><RelativeTime :timestamp="incident.openedAt" /></td>
        <td data-cell="state"><IncidentState :incident="incident" /></td>
      </tr>
    </DataList>
    <div class="section-heading"><h2>Monitors needing attention</h2></div>
    <DataList :columns="ATTENTION_COLUMNS" :loading="loading" :error="null" :is-empty="(overview?.attention.length ?? 0) === 0" empty-title="No monitor is down or drifted">
      <tr v-for="monitor in overview?.attention" :key="monitor.id" data-monitor>
        <td>
          <RouterLink class="cell-primary" :to="{ name: 'monitor', params: { id: monitor.id } }">{{ monitor.name }}</RouterLink>
          <div class="mono muted">{{ monitor.url }}</div>
        </td>
        <td><StatusPill :health="monitor.summary.health" :severity="monitor.summary.openIncident?.severity ?? null" /></td>
        <td class="text-secondary"><RelativeTime v-if="monitor.summary.latestProbe !== null" :timestamp="monitor.summary.latestProbe.startedAt" /></td>
      </tr>
    </DataList>
  </template>
</template>

<style scoped>
.counters {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
  padding: var(--space-4) 18px 0;
}

.counter {
  display: block;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--scalar-border-color);
  border-radius: var(--radius-lg);
  background: var(--scalar-background-2);
  color: var(--scalar-color-1);
}

.counter:hover {
  border-color: var(--scalar-color-3);
  text-decoration: none;
}

.counter b {
  display: block;
  margin-top: 2px;
  font-size: 20px;
  font-weight: 600;
}

.section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 18px;
}
</style>
