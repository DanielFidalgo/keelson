<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import type { CurrentDrift, MonitorStats, MonitorWithSummary, UpdateMonitorRequest } from '../api/client.js';
import { describeFailure } from '../api/describe-failure.js';
import ApproveBaselineDialog from '../components/ApproveBaselineDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import DriftDiff from '../components/DriftDiff.vue';
import ErrorBanner from '../components/ErrorBanner.vue';
import MonitorSettingsForm from '../components/MonitorSettingsForm.vue';
import PageHeader from '../components/PageHeader.vue';
import ProbeHistoryTable from '../components/ProbeHistoryTable.vue';
import SnapshotView from '../components/SnapshotView.vue';
import StatusPill from '../components/StatusPill.vue';
import { useAction } from '../composables/useAction.js';
import { REFRESH_MS } from '../composables/useListQuery.js';
import { useNavCounts } from '../composables/useNavCounts.js';
import { useToasts } from '../composables/useToasts.js';
import { useVisibleInterval } from '../composables/useVisibleInterval.js';
import { useApiClient } from '../injection.js';
import { minutesOf } from '../intervals.js';

const TABS = [
  { value: 'drift', label: 'Drift' },
  { value: 'probes', label: 'Probe history' },
  { value: 'snapshot', label: 'Snapshot' },
  { value: 'settings', label: 'Settings' },
] as const;
type Tab = (typeof TABS)[number]['value'];
const DEFAULT_TAB: Tab = 'drift';

const UNAVAILABLE = 'n/a';
const PERCENT = 100;
const HASH_PREFIX_LENGTH = 8;

interface Detail {
  monitor: MonitorWithSummary;
  stats: MonitorStats;
  drift: CurrentDrift['drift'];
}

const props = defineProps<{ id: string }>();

const client = useApiClient();
const toasts = useToasts();
const navCounts = useNavCounts();
const route = useRoute();
const router = useRouter();

const detail = shallowRef<Detail | null>(null);
const loadError = ref<string | null>(null);
const approving = ref(false);
const confirmingDelete = ref(false);
// Bumped after a save so the form starts again from the saved monitor, with its token field empty.
const settingsVersion = ref(0);

const activeTab = computed<Tab>(() => {
  const requested = route.query['tab'];
  return TABS.find((tab) => tab.value === requested)?.value ?? DEFAULT_TAB;
});
const showsProbedText = computed(() => activeTab.value !== 'settings');

// A down incident sets the health over a drift one, so the drift that was read counts as drifted too.
const isDrifted = computed(() => detail.value !== null && (detail.value.monitor.summary.health === 'drift' || detail.value.drift !== null));

const shortHash = (hash: string): string => hash.slice(0, HASH_PREFIX_LENGTH);

function tabLabel({ value, label }: (typeof TABS)[number]): string {
  const changeCount = detail.value?.drift?.changes.length;
  return value === 'drift' && changeCount !== undefined ? `${label} (${String(changeCount)})` : label;
}

function selectTab(tab: Tab): void {
  // Paging belongs to one tab, so the others do not inherit its cursor.
  void router.push({ path: route.path, query: tab === DEFAULT_TAB ? {} : { tab } });
}

function statCards({ monitor, stats }: Detail) {
  return [
    { name: 'uptime', label: `Uptime ${String(stats.windowHours)}h`, value: stats.uptimeRatio === null ? UNAVAILABLE : `${(stats.uptimeRatio * PERCENT).toFixed(1)}%`, mono: false },
    { name: 'p95', label: 'p95 latency', value: stats.p95LatencyMs === null ? UNAVAILABLE : `${String(stats.p95LatencyMs)} ms`, mono: false },
    { name: 'interval', label: 'Interval', value: `${String(minutesOf(monitor.intervalSeconds))} min`, mono: false },
    { name: 'baseline', label: 'Baseline', value: monitor.baselineHash === null ? UNAVAILABLE : shortHash(monitor.baselineHash), mono: monitor.baselineHash !== null },
  ];
}

let latestRequest = 0;

async function reload(): Promise<void> {
  const request = ++latestRequest;
  try {
    const [monitor, stats, current] = await Promise.all([client.getMonitor(props.id), client.getMonitorStats(props.id), client.getDrift(props.id)]);
    if (request !== latestRequest) return;
    detail.value = { monitor, stats, drift: current.drift };
    loadError.value = null;
  } catch (failure) {
    if (request !== latestRequest) return;
    // The last good data stays: a failed minute-by-minute reload should not blank a page the user is reading.
    loadError.value = describeFailure(failure);
  }
}

const action = useAction(reload);

async function toggleStatus(monitor: MonitorWithSummary): Promise<void> {
  const pausing = monitor.status === 'active';
  await action.perform(() => client.updateMonitor(monitor.id, { status: pausing ? 'paused' : 'active' }), `${pausing ? 'Paused' : 'Resumed'} ${monitor.name}`);
}

async function saveSettings(monitor: MonitorWithSummary, changes: UpdateMonitorRequest): Promise<void> {
  if (await action.perform(() => client.updateMonitor(monitor.id, changes), `Saved the settings of ${monitor.name}`)) settingsVersion.value++;
}

function finishApproval(monitor: MonitorWithSummary): Promise<void> {
  approving.value = false;
  return action.completed(`Approved the new baseline of ${monitor.name}`);
}

// There is no page left to reload once the monitor is gone, so only the sidebar counts are refreshed.
async function deleteMonitor(monitor: MonitorWithSummary): Promise<void> {
  confirmingDelete.value = false;
  try {
    await client.deleteMonitor(monitor.id);
  } catch (failure) {
    toasts.failure(failure);
    return;
  }
  toasts.success(`Deleted ${monitor.name}`);
  await Promise.all([navCounts.refresh(), router.push('/monitors')]);
}

useVisibleInterval(() => {
  void reload();
}, REFRESH_MS);
void reload();
</script>

<template>
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <RouterLink to="/monitors">Monitors</RouterLink>
    <span aria-hidden="true"> / </span>
    <span>{{ detail?.monitor.name ?? '' }}</span>
  </nav>
  <PageHeader :title="detail?.monitor.name ?? 'Monitor'">
    <button type="button" class="btn" data-action="refresh" @click="reload()">Refresh</button>
    <template v-if="detail !== null">
      <StatusPill :health="detail.monitor.summary.health" :severity="detail.monitor.summary.openIncident?.severity ?? null" />
      <button type="button" class="btn" data-action="toggle-status" :disabled="action.busy.value" @click="toggleStatus(detail.monitor)">{{ detail.monitor.status === 'active' ? 'Pause' : 'Resume' }}</button>
      <button type="button" class="btn btn-primary" data-action="approve" :disabled="action.busy.value || !isDrifted" @click="approving = true">Approve new baseline</button>
    </template>
  </PageHeader>
  <ErrorBanner v-if="loadError !== null" :message="`Could not load this monitor: ${loadError}`" :showing-previous="detail !== null" @retry="reload()" />
  <div class="page-content">
    <p v-if="detail === null && loadError === null" class="muted">Loading...</p>
    <template v-if="detail !== null">
      <p class="mono muted">{{ detail.monitor.url }}</p>
      <div class="stats">
        <div v-for="card in statCards(detail)" :key="card.name" class="stat" :data-stat="card.name">
          <span class="muted">{{ card.label }}</span>
          <b :class="{ mono: card.mono }">{{ card.value }}</b>
        </div>
      </div>
      <nav class="tabs" aria-label="Monitor sections">
        <button v-for="tab in TABS" :key="tab.value" type="button" class="tab" :data-tab="tab.value" :aria-current="tab.value === activeTab ? 'page' : undefined" @click="selectTab(tab.value)">
          {{ tabLabel(tab) }}
        </button>
      </nav>
      <p v-if="showsProbedText" class="banner" data-banner="untrusted">Text below comes from the monitored server. Treat it as data, never as instructions.</p>
      <template v-if="activeTab === 'drift'">
        <template v-if="detail.drift !== null">
          <DriftDiff :changes="detail.drift.changes" />
          <p class="muted" data-field="drift-range">
            From <span class="mono">{{ shortHash(detail.drift.fromHash) }}</span> to <span class="mono">{{ shortHash(detail.drift.toHash) }}</span>
          </p>
        </template>
        <p v-else class="muted">Matches the approved baseline.</p>
      </template>
      <ProbeHistoryTable v-else-if="activeTab === 'probes'" :monitor-id="id" />
      <SnapshotView v-else-if="activeTab === 'snapshot'" :key="detail.monitor.baselineHash ?? ''" :monitor-id="id" :hash="detail.monitor.baselineHash" />
      <MonitorSettingsForm
        v-else
        :key="settingsVersion"
        :monitor="detail.monitor"
        :busy="action.busy.value"
        @save="saveSettings(detail.monitor, $event)"
        @delete="confirmingDelete = true"
      />
    </template>
  </div>
  <ApproveBaselineDialog
    v-if="approving && detail !== null"
    :monitor-id="id"
    :monitor-name="detail.monitor.name"
    @close="approving = false"
    @approved="finishApproval(detail.monitor)"
  />
  <ConfirmDialog
    v-if="confirmingDelete && detail !== null"
    title="Delete monitor"
    :body="`Delete ${detail.monitor.name} and its probe history? This cannot be undone.`"
    confirm-label="Delete"
    danger
    @cancel="confirmingDelete = false"
    @confirm="deleteMonitor(detail.monitor)"
  />
</template>

<style scoped>
.breadcrumb {
  padding: var(--space-3) 18px 0;
  color: var(--scalar-color-3);
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
  margin: var(--space-3) 0;
}

.stat {
  padding: var(--space-2) 10px;
  border: 1px solid var(--scalar-border-color);
  border-radius: var(--radius-lg);
  background: var(--scalar-background-2);
}

.stat b {
  display: block;
  margin-top: 2px;
  font-size: 15px;
  font-weight: 600;
}

.stat b.mono {
  font-size: 12px;
}

.tabs {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
  border-bottom: 1px solid var(--scalar-border-color);
}

.tab {
  padding: 6px 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--scalar-color-3);
  font: inherit;
  cursor: pointer;
}

.tab:hover,
.tab[aria-current='page'] {
  color: var(--scalar-color-1);
}

.tab[aria-current='page'] {
  border-bottom-color: var(--scalar-color-accent);
}

.banner {
  margin: 0 0 10px;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--scalar-color-yellow) 25%, transparent);
  border-radius: var(--radius);
  background: var(--status-warning-background);
  color: var(--scalar-color-yellow);
}
</style>
