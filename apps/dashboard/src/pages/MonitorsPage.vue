<script setup lang="ts">
import { RouterLink } from 'vue-router';
import DataList from '../components/DataList.vue';
import LatencySparkline from '../components/LatencySparkline.vue';
import ListPagination from '../components/ListPagination.vue';
import PageHeader from '../components/PageHeader.vue';
import RelativeTime from '../components/RelativeTime.vue';
import StatusPill from '../components/StatusPill.vue';
import type { MonitorSummary } from '../api/client.js';
import { PAGE_SIZES, useListQuery } from '../composables/useListQuery.js';
import { useApiClient } from '../injection.js';

const COLUMNS = ['Monitor', 'Status', 'Latency', 'Tools', 'Last probe'];

const client = useApiClient();
const list = useListQuery({ defaults: {}, pageSizes: PAGE_SIZES, load: ({ cursor, limit }) => client.listMonitors({ cursor, limit }) });

function latestLatency({ latestProbe }: MonitorSummary): string {
  if (latestProbe === null) return '';
  return latestProbe.outcome === 'up' ? `${String(latestProbe.latencyMs)} ms` : latestProbe.outcome.replace('_', ' ');
}
</script>

<template>
  <PageHeader title="Monitors" />
  <DataList :columns="COLUMNS" :loading="list.loading" :error="list.error" :is-empty="list.items.length === 0" empty-title="No monitors yet" @retry="list.refresh()">
    <tr v-for="monitor in list.items" :key="monitor.id">
      <td>
        <RouterLink class="cell-primary" :to="{ name: 'monitor', params: { id: monitor.id } }">{{ monitor.name }}</RouterLink>
        <div class="mono muted">{{ monitor.url }}</div>
      </td>
      <td><StatusPill :health="monitor.summary.health" :severity="monitor.summary.openIncident?.severity ?? null" /></td>
      <td>
        <LatencySparkline :values="monitor.summary.recentLatenciesMs" />
        <span class="latency-value mono muted">{{ latestLatency(monitor.summary) }}</span>
      </td>
      <td>{{ monitor.summary.toolCount ?? '' }}</td>
      <td class="text-secondary"><RelativeTime v-if="monitor.summary.latestProbe !== null" :timestamp="monitor.summary.latestProbe.startedAt" /></td>
    </tr>
  </DataList>
  <ListPagination
    :range-label="list.rangeLabel"
    :page-size="list.pageSize"
    :page-sizes="PAGE_SIZES"
    :has-previous="list.hasPrevious"
    :has-next="list.hasNext"
    @previous="list.previous()"
    @next="list.next()"
    @update:page-size="list.setPageSize($event)"
  />
</template>

<style scoped>
.latency-value {
  margin-left: var(--space-2);
}
</style>
