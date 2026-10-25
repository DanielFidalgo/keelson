<script setup lang="ts">
import type { Probe } from '../api/client.js';
import { PAGE_SIZES, useListQuery } from '../composables/useListQuery.js';
import { useApiClient } from '../injection.js';
import { PROBE_OUTCOME_LABELS } from '../labels.js';
import DataList from './DataList.vue';
import ListPagination from './ListPagination.vue';
import RelativeTime from './RelativeTime.vue';
import StatusPill from './StatusPill.vue';

const props = defineProps<{ monitorId: string }>();

const COLUMNS = ['Time', 'Outcome', 'Latency', 'Server', 'Detail'];

const client = useApiClient();

const list = useListQuery<Record<string, never>, Probe>({
  defaults: {},
  pageSizes: PAGE_SIZES,
  load: ({ cursor, limit }) => client.listProbes(props.monitorId, { cursor, limit }),
});

const serverOf = ({ serverName, serverVersion }: Probe): string => [serverName, serverVersion].filter((part) => part !== null).join(' ');
</script>

<template>
  <DataList
    :columns="COLUMNS"
    :loading="list.loading"
    :error="list.error"
    :is-empty="list.items.length === 0"
    empty-title="Not probed yet"
    empty-hint="Probes appear here once the monitor has run."
    @retry="list.refresh()"
  >
    <tr v-for="probe in list.items" :key="probe.id">
      <td class="text-secondary"><RelativeTime :timestamp="probe.startedAt" /></td>
      <td><StatusPill :health="probe.outcome === 'up' ? 'up' : 'down'" :label="PROBE_OUTCOME_LABELS[probe.outcome]" /></td>
      <td class="mono">{{ probe.latencyMs }} ms</td>
      <td>{{ serverOf(probe) }}</td>
      <td class="detail"><span class="detail-text" :title="probe.errorDetail ?? undefined">{{ probe.errorDetail }}</span></td>
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
.detail {
  max-width: 320px;
}

.detail-text {
  display: block;
  overflow: hidden;
  color: var(--scalar-color-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
