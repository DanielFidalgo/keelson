<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { RouterLink } from 'vue-router';
import DataList from '../components/DataList.vue';
import ListPagination from '../components/ListPagination.vue';
import PageHeader from '../components/PageHeader.vue';
import RelativeTime from '../components/RelativeTime.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import StatusPill from '../components/StatusPill.vue';
import type { IncidentCounts, IncidentListParams, IncidentView } from '../api/client.js';
import { PAGE_SIZES, useListQuery } from '../composables/useListQuery.js';
import { useNavCounts } from '../composables/useNavCounts.js';
import { useToasts } from '../composables/useToasts.js';
import { useApiClient } from '../injection.js';

type Tab = 'open' | 'acknowledged' | 'resolved';
type Kind = 'drift' | 'down';

const TABS = [
  ['open', 'Open'],
  ['acknowledged', 'Acknowledged'],
  ['resolved', 'Resolved'],
] as const satisfies readonly (readonly [Tab, string])[];
const KINDS = [
  ['drift', 'Drift'],
  ['down', 'Down'],
] as const satisfies readonly (readonly [Kind, string])[];
const DEFAULT_TAB: Tab = 'open';
// An acknowledged incident is still open, so the API tells the tabs apart by its acknowledged flag.
const TAB_REQUESTS: Record<Tab, Pick<IncidentListParams, 'state' | 'acknowledged'>> = {
  open: { state: 'open', acknowledged: false },
  acknowledged: { state: 'open', acknowledged: true },
  resolved: { state: 'resolved', acknowledged: null },
};
const RESOLUTION_LABELS = { recovered: 'Recovered', approved: 'Approved', reverted: 'Reverted' } as const;
const FILTER_DEFAULTS: { state: string | null; kind: string | null } = { state: DEFAULT_TAB, kind: null };
const COLUMNS = ['Monitor', 'Kind', 'Opened', 'State'];

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

const client = useApiClient();
const toasts = useToasts();
const navCounts = useNavCounts();

const counts = shallowRef<IncidentCounts | null>(null);
const acknowledging = ref(false);

// A state or kind in a pasted link that the API does not know would be a 400, so it is read as the default.
function tabOf(requested: string | null): Tab {
  return TABS.find(([tab]) => tab === requested)?.[0] ?? DEFAULT_TAB;
}

function kindOf(requested: string | null): Kind | null {
  return KINDS.find(([kind]) => kind === requested)?.[0] ?? null;
}

async function refreshCounts(): Promise<void> {
  try {
    counts.value = await client.getIncidentCounts();
  } catch {
    // The counts only decorate the tabs, and the list beside them reports its own failures.
    counts.value = null;
  }
}

// The counts are read with every page so they never disagree with it after a filter, an action or a timed refresh.
async function loadIncidentsAndCounts({ filters, cursor, limit }: { filters: typeof FILTER_DEFAULTS; cursor: string | null; limit: number }) {
  const [page] = await Promise.all([client.listIncidents({ ...TAB_REQUESTS[tabOf(filters.state)], kind: kindOf(filters.kind), cursor, limit }), refreshCounts()]);
  return page;
}

const list = useListQuery({ defaults: FILTER_DEFAULTS, pageSizes: PAGE_SIZES, load: loadIncidentsAndCounts });

const activeTab = computed(() => tabOf(list.filters.state));
const activeKind = computed(() => kindOf(list.filters.kind));
const tabLabel = computed(() => TABS.find(([tab]) => tab === activeTab.value)?.[1] ?? '');
const emptyHint = computed(() => (activeKind.value === null ? {} : { emptyHint: 'Try all kinds.' }));
const columns = computed(() => [...COLUMNS, activeTab.value === 'resolved' ? 'Duration' : 'Actions']);

const tabOptions = computed(() => TABS.map(([tab, label]) => ({ value: tab, label, ...(counts.value === null ? {} : { count: counts.value[tab] }) })));
// Kinds carry no counts: the API counts open incidents of a kind, which would disagree with the Acknowledged and Resolved tabs.
const kindOptions = [{ value: null, label: 'All kinds' }, ...KINDS.map(([kind, label]) => ({ value: kind, label }))];

function lastedFor({ openedAt, resolvedAt }: IncidentView): string {
  if (resolvedAt === null) return '';
  const minutes = Math.floor((Date.parse(resolvedAt) - Date.parse(openedAt)) / MINUTE_MS);
  if (minutes < 1) return '< 1 min';
  const days = Math.floor(minutes / MINUTES_PER_DAY);
  const hours = Math.floor((minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  if (days > 0) return hours > 0 ? `${String(days)} d ${String(hours)} h` : `${String(days)} d`;
  if (hours > 0) return rest > 0 ? `${String(hours)} h ${String(rest)} min` : `${String(hours)} h`;
  return `${String(rest)} min`;
}

function resolutionLabel({ resolution }: IncidentView): string {
  return resolution === null ? 'Resolved' : RESOLUTION_LABELS[resolution];
}

async function acknowledge(incidentId: string): Promise<void> {
  acknowledging.value = true;
  try {
    await client.acknowledgeIncident(incidentId);
    toasts.success('Incident acknowledged');
    await Promise.all([list.refreshAfterChange(), navCounts.refresh()]);
  } catch (failure) {
    toasts.failure(failure);
  } finally {
    acknowledging.value = false;
  }
}
</script>

<template>
  <PageHeader title="Incidents" />
  <div class="toolbar">
    <SegmentedControl label="State" :model-value="activeTab" :options="tabOptions" @update:model-value="list.setFilter('state', $event)" />
    <SegmentedControl label="Kind" :model-value="activeKind" :options="kindOptions" @update:model-value="list.setFilter('kind', $event)" />
    <button type="button" class="btn refresh" data-action="refresh" @click="list.refresh()">Refresh</button>
  </div>
  <DataList
    :columns="columns"
    :loading="list.loading"
    :error="list.error"
    :is-empty="list.items.length === 0"
    :empty-title="`No ${tabLabel.toLowerCase()} incidents`"
    v-bind="emptyHint"
    @retry="list.refresh()"
  >
    <tr v-for="incident in list.items" :key="incident.id">
      <td>
        <RouterLink class="cell-primary" :to="{ name: 'monitor', params: { id: incident.monitorId } }">{{ incident.monitorName }}</RouterLink>
      </td>
      <td><StatusPill :health="incident.kind" :severity="incident.severity" /></td>
      <td class="text-secondary"><RelativeTime :timestamp="incident.openedAt" /></td>
      <td data-cell="state">
        <StatusPill v-if="incident.state === 'resolved'" health="resolved" :label="resolutionLabel(incident)" />
        <template v-else-if="incident.acknowledgedAt !== null">Acknowledged <RelativeTime class="text-secondary" :timestamp="incident.acknowledgedAt" /></template>
        <template v-else>Open</template>
      </td>
      <td>
        <span v-if="incident.state === 'resolved'" class="muted" data-duration>{{ lastedFor(incident) }}</span>
        <button v-else-if="incident.acknowledgedAt === null" type="button" class="btn btn-small" data-action="acknowledge" :disabled="acknowledging" @click="acknowledge(incident.id)">
          Acknowledge
        </button>
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

<style scoped>
.refresh {
  margin-left: auto;
}
</style>
