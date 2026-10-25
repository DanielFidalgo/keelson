<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { RouterLink } from 'vue-router';
import DataList from '../components/DataList.vue';
import IncidentState from '../components/IncidentState.vue';
import ListPagination from '../components/ListPagination.vue';
import PageHeader from '../components/PageHeader.vue';
import RelativeTime from '../components/RelativeTime.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import StatusPill from '../components/StatusPill.vue';
import type { IncidentCounts, IncidentListParams, IncidentView } from '../api/client.js';
import { PAGE_SIZES, useListQuery } from '../composables/useListQuery.js';
import { useAction } from '../composables/useAction.js';
import { useApiClient } from '../injection.js';
import { INCIDENT_KIND_LABELS, INCIDENT_STATE_LABELS } from '../labels.js';

type Tab = 'open' | 'acknowledged' | 'resolved';
type Kind = 'drift' | 'down';

const TABS: readonly Tab[] = ['open', 'acknowledged', 'resolved'];
const KINDS: readonly Kind[] = ['drift', 'down'];
const DEFAULT_TAB: Tab = 'open';
// An acknowledged incident is still open, so the API tells the tabs apart by its acknowledged flag.
const TAB_REQUESTS: Record<Tab, Pick<IncidentListParams, 'state' | 'acknowledged'>> = {
  open: { state: 'open', acknowledged: false },
  acknowledged: { state: 'open', acknowledged: true },
  resolved: { state: 'resolved', acknowledged: null },
};
const FILTER_DEFAULTS: { state: string | null; kind: string | null } = { state: DEFAULT_TAB, kind: null };
const COLUMNS = ['Monitor', 'Kind', 'Opened', 'State'];

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

const client = useApiClient();

const counts = shallowRef<IncidentCounts | null>(null);

// A state or kind in a pasted link that the API does not know would be a 400, so it is read as the default.
function tabOf(requested: string | null): Tab {
  return TABS.find((tab) => tab === requested) ?? DEFAULT_TAB;
}

function kindOf(requested: string | null): Kind | null {
  return KINDS.find((kind) => kind === requested) ?? null;
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

const action = useAction(() => list.refreshAfterChange());
const activeTab = computed(() => tabOf(list.filters.state));
const activeKind = computed(() => kindOf(list.filters.kind));
const tabLabel = computed(() => INCIDENT_STATE_LABELS[activeTab.value]);
const emptyHint = computed(() => (activeKind.value === null ? {} : { emptyHint: 'Try all kinds.' }));
const columns = computed(() => [...COLUMNS, activeTab.value === 'resolved' ? 'Duration' : 'Actions']);

const tabOptions = computed(() => TABS.map((tab) => ({ value: tab, label: INCIDENT_STATE_LABELS[tab], ...(counts.value === null ? {} : { count: counts.value[tab] }) })));
// Kinds carry no counts: the API counts open incidents of a kind, which would disagree with the Acknowledged and Resolved tabs.
const kindOptions = [{ value: null, label: 'All kinds' }, ...KINDS.map((kind) => ({ value: kind, label: INCIDENT_KIND_LABELS[kind] }))];

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

function acknowledge(incidentId: string): Promise<boolean> {
  return action.perform(() => client.acknowledgeIncident(incidentId), 'Incident acknowledged');
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
      <td data-cell="state"><IncidentState :incident="incident" /></td>
      <td>
        <span v-if="incident.state === 'resolved'" class="muted" data-duration>{{ lastedFor(incident) }}</span>
        <button v-else-if="incident.acknowledgedAt === null" type="button" class="btn btn-small" data-action="acknowledge" :disabled="action.busy.value" @click="acknowledge(incident.id)">
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
