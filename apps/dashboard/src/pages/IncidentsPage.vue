<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import DataList from '../components/DataList.vue';
import ListPagination from '../components/ListPagination.vue';
import PageHeader from '../components/PageHeader.vue';
import RelativeTime from '../components/RelativeTime.vue';
import StatusPill from '../components/StatusPill.vue';
import { PAGE_SIZES, useListQuery } from '../composables/useListQuery.js';
import { useNavCounts } from '../composables/useNavCounts.js';
import { useToasts } from '../composables/useToasts.js';
import { useApiClient } from '../injection.js';

const COLUMNS = ['Monitor', 'Kind', 'Opened', 'Acknowledgement'];

const client = useApiClient();
const toasts = useToasts();
const navCounts = useNavCounts();
const list = useListQuery({ defaults: {}, pageSizes: PAGE_SIZES, load: ({ cursor, limit }) => client.listIncidents({ state: 'open', cursor, limit }) });
const acknowledging = ref(false);

async function acknowledge(incidentId: string): Promise<void> {
  acknowledging.value = true;
  try {
    await client.acknowledgeIncident(incidentId);
    toasts.success('Incident acknowledged');
    await Promise.all([list.refresh(), navCounts.refresh()]);
  } catch (error) {
    toasts.failure(error);
  } finally {
    acknowledging.value = false;
  }
}
</script>

<template>
  <PageHeader title="Incidents" />
  <DataList :columns="COLUMNS" :loading="list.loading" :error="list.error" :is-empty="list.items.length === 0" empty-title="No open incidents" @retry="list.refresh()">
    <tr v-for="incident in list.items" :key="incident.id">
      <td>
        <RouterLink class="cell-primary" :to="{ name: 'monitor', params: { id: incident.monitorId } }">{{ incident.monitorName }}</RouterLink>
      </td>
      <td><StatusPill :health="incident.kind" :severity="incident.severity" /></td>
      <td class="text-secondary"><RelativeTime :timestamp="incident.openedAt" /></td>
      <td>
        <template v-if="incident.acknowledgedAt !== null">Acknowledged <RelativeTime :timestamp="incident.acknowledgedAt" /></template>
        <button v-else type="button" class="btn btn-small" data-action="acknowledge" :disabled="acknowledging" @click="acknowledge(incident.id)">Acknowledge</button>
      </td>
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
