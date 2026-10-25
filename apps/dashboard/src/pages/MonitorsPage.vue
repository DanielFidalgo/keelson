<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { RouterLink } from 'vue-router';
import AddMonitorDialog from '../components/AddMonitorDialog.vue';
import ApproveBaselineDialog from '../components/ApproveBaselineDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import DataList from '../components/DataList.vue';
import LatencySparkline from '../components/LatencySparkline.vue';
import ListPagination from '../components/ListPagination.vue';
import MonitorRowMenu from '../components/MonitorRowMenu.vue';
import PageHeader from '../components/PageHeader.vue';
import RelativeTime from '../components/RelativeTime.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import StatusPill from '../components/StatusPill.vue';
import type { HealthCounts, HealthState, Monitor, MonitorSummary, MonitorWithSummary } from '../api/client.js';
import { PAGE_SIZES, SEARCH_DEBOUNCE_MS, useListQuery } from '../composables/useListQuery.js';
import { useNavCounts } from '../composables/useNavCounts.js';
import { useToasts } from '../composables/useToasts.js';
import { useApiClient } from '../injection.js';

const COLUMNS = ['Monitor', 'Status', 'Latency', 'Tools', 'Last probe', 'Actions'];
const HEALTH_FILTERS = [
  ['up', 'Up'],
  ['drift', 'Drift'],
  ['down', 'Down'],
  ['paused', 'Paused'],
  ['pending', 'Pending'],
] as const satisfies readonly (readonly [HealthState, string])[];
const FILTER_DEFAULTS: { health: string | null; q: string | null } = { health: null, q: null };
// The API rejects a longer search, so the box does not let one be typed. openapi.yaml is the source of this number.
const SEARCH_MAX_LENGTH = 100;

const client = useApiClient();
const toasts = useToasts();
const navCounts = useNavCounts();

const healthCounts = shallowRef<HealthCounts | null>(null);
const addingMonitor = ref(false);
const monitorToApprove = shallowRef<MonitorWithSummary | null>(null);
const monitorToDelete = shallowRef<MonitorWithSummary | null>(null);

// A health in a pasted link that is not one of the states would be a 400, so it is read as no filter.
function healthOf(requested: string | null): HealthState | null {
  return HEALTH_FILTERS.find(([state]) => state === requested)?.[0] ?? null;
}

async function refreshHealthCounts(): Promise<void> {
  try {
    healthCounts.value = await client.getHealthCounts();
  } catch {
    // The counts only decorate the filter, and the list beside them reports its own failures.
    healthCounts.value = null;
  }
}

// The counts are read with every page so they never disagree with it after a filter, an action or a timed refresh.
async function loadMonitorsAndCounts({ filters, cursor, limit }: { filters: typeof FILTER_DEFAULTS; cursor: string | null; limit: number }) {
  const [page] = await Promise.all([client.listMonitors({ health: healthOf(filters.health), q: filters.q, cursor, limit }), refreshHealthCounts()]);
  return page;
}

const list = useListQuery({ defaults: FILTER_DEFAULTS, pageSizes: PAGE_SIZES, load: loadMonitorsAndCounts });

const activeHealth = computed(() => healthOf(list.filters.health));
const isFiltered = computed(() => activeHealth.value !== null || (list.filters.q ?? '') !== '');

const healthOptions = computed(() => {
  const counts = healthCounts.value;
  const countFor = (state: HealthState | 'total') => (counts === null ? {} : { count: counts[state] });
  const shown = HEALTH_FILTERS.filter(([state]) => state !== 'pending' || state === activeHealth.value || (counts?.pending ?? 0) > 0);
  return [{ value: null, label: 'All', ...countFor('total') }, ...shown.map(([state, label]) => ({ value: state, label, ...countFor(state) }))];
});

const searchText = ref(list.filters.q ?? '');
let pendingSearch: ReturnType<typeof setTimeout> | undefined;

function applySearch(): void {
  pendingSearch = undefined;
  const search = searchText.value.trim();
  if (search === (list.filters.q ?? '')) return;
  list.setFilter('q', search === '' ? null : search);
}

watch(searchText, () => {
  clearTimeout(pendingSearch);
  pendingSearch = setTimeout(applySearch, SEARCH_DEBOUNCE_MS);
});
// The browser's Back and Forward change the URL under the box. A search still being typed wins, so a late arrival cannot eat keystrokes.
watch(
  () => list.filters.q,
  (search) => {
    if (pendingSearch === undefined) searchText.value = search ?? '';
  },
);
onBeforeUnmount(() => {
  clearTimeout(pendingSearch);
});

async function afterChange(): Promise<void> {
  await Promise.all([list.refresh(), navCounts.refresh()]);
  // Acting on the only row of the last page leaves that page empty, and the only way on from an empty page is back.
  if (list.items.length === 0 && list.error === null && list.hasPrevious) list.previous();
}

async function completed(message: string): Promise<void> {
  toasts.success(message);
  await afterChange();
}

async function perform(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
  } catch (failure) {
    toasts.failure(failure);
    return;
  }
  await completed(message);
}

function setStatus(monitor: MonitorWithSummary, status: Monitor['status']): Promise<void> {
  return perform(() => client.updateMonitor(monitor.id, { status }), `${status === 'paused' ? 'Paused' : 'Resumed'} ${monitor.name}`);
}

function deleteMonitor(monitor: MonitorWithSummary): Promise<void> {
  monitorToDelete.value = null;
  return perform(() => client.deleteMonitor(monitor.id), `Deleted ${monitor.name}`);
}

function finishAdding(monitor: Monitor): Promise<void> {
  addingMonitor.value = false;
  return completed(`Added ${monitor.name}`);
}

function finishApproval(monitor: MonitorWithSummary): Promise<void> {
  monitorToApprove.value = null;
  return completed(`Approved the new baseline of ${monitor.name}`);
}

function latestLatency({ latestProbe }: MonitorSummary): string {
  if (latestProbe === null) return '';
  return latestProbe.outcome === 'up' ? `${String(latestProbe.latencyMs)} ms` : latestProbe.outcome.replace('_', ' ');
}
</script>

<template>
  <PageHeader title="Monitors">
    <input v-model="searchText" class="input search" type="search" aria-label="Search monitors" placeholder="Search name or URL…" :maxlength="SEARCH_MAX_LENGTH" />
    <button type="button" class="btn btn-primary" data-action="add-monitor" @click="addingMonitor = true">+ Add monitor</button>
  </PageHeader>
  <div class="toolbar">
    <SegmentedControl label="Health" :model-value="activeHealth" :options="healthOptions" @update:model-value="list.setFilter('health', $event)" />
    <button type="button" class="btn refresh" data-action="refresh" @click="list.refresh()">Refresh</button>
  </div>
  <DataList
    :columns="COLUMNS"
    :loading="list.loading"
    :error="list.error"
    :is-empty="list.items.length === 0"
    :empty-title="isFiltered ? 'No monitors match' : 'No monitors yet'"
    :empty-hint="isFiltered ? 'Try a different search or health filter.' : 'Add a monitor to start watching an MCP server.'"
    @retry="list.refresh()"
  >
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
      <td class="actions-cell">
        <MonitorRowMenu
          :monitor="monitor"
          @approve="monitorToApprove = monitor"
          @pause="setStatus(monitor, 'paused')"
          @resume="setStatus(monitor, 'active')"
          @delete="monitorToDelete = monitor"
        />
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
  <AddMonitorDialog v-if="addingMonitor" @close="addingMonitor = false" @created="finishAdding" />
  <ApproveBaselineDialog
    v-if="monitorToApprove !== null"
    :monitor-id="monitorToApprove.id"
    :monitor-name="monitorToApprove.name"
    @close="monitorToApprove = null"
    @approved="finishApproval(monitorToApprove)"
  />
  <ConfirmDialog
    v-if="monitorToDelete !== null"
    title="Delete monitor"
    :body="`Delete ${monitorToDelete.name} and its probe history? This cannot be undone.`"
    confirm-label="Delete"
    danger
    @cancel="monitorToDelete = null"
    @confirm="deleteMonitor(monitorToDelete)"
  />
</template>

<style scoped>
.search {
  width: 220px;
}

.refresh {
  margin-left: auto;
}

.latency-value {
  margin-left: var(--space-2);
}

.actions-cell {
  text-align: right;
}
</style>
