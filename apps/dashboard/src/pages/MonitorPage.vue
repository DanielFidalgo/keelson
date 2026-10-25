<script setup lang="ts">
import { RouterLink } from 'vue-router';
import DriftDiff from '../components/DriftDiff.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusPill from '../components/StatusPill.vue';
import { useLoadedData } from '../composables/useLoadedData.js';
import { formatTime } from '../format.js';
import { useApiClient } from '../injection.js';

const props = defineProps<{ id: string }>();

const client = useApiClient();
const { data, errorMessage, busy, change } = useLoadedData(async () => {
  const [monitor, probes, currentDrift] = await Promise.all([client.getMonitor(props.id), client.listProbes(props.id, {}), client.getDrift(props.id)]);
  return { monitor, probes: probes.items, drift: currentDrift.drift };
});

function approve(snapshotHash: string): Promise<void> {
  return change(() => client.approveBaseline(props.id, snapshotHash));
}
</script>

<template>
  <PageHeader :title="data?.monitor.name ?? 'Monitor'">
    <StatusPill v-if="data !== null" :health="data.monitor.summary.health" :severity="data.monitor.summary.openIncident?.severity ?? null" />
  </PageHeader>
  <div class="page-content">
    <p><RouterLink to="/monitors">All monitors</RouterLink></p>
    <p v-if="errorMessage !== null" role="alert" class="error">{{ errorMessage }}</p>
    <p v-if="data === null && errorMessage === null" class="muted">Loading...</p>
    <template v-if="data !== null">
      <p class="mono muted">{{ data.monitor.url }}</p>
      <p>Status: {{ data.monitor.status }}. Probed every {{ data.monitor.intervalSeconds }} seconds.</p>

      <h2>Drift</h2>
      <template v-if="data.drift !== null">
        <DriftDiff :changes="data.drift.changes" />
        <button type="button" class="btn btn-primary" data-action="approve" :disabled="busy" @click="approve(data.drift.toHash)">Approve as the new baseline</button>
      </template>
      <p v-else class="muted">No drift from the approved baseline.</p>

      <h2>Probe history</h2>
      <p v-if="data.probes.length === 0" class="muted">Not probed yet.</p>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>Started</th>
            <th>Outcome</th>
            <th>Latency</th>
            <th>Server</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="probe in data.probes" :key="probe.id">
            <td>{{ formatTime(probe.startedAt) }}</td>
            <td>{{ probe.outcome }}</td>
            <td>{{ probe.latencyMs }} ms</td>
            <td>{{ probe.serverName }} {{ probe.serverVersion }}</td>
            <td>{{ probe.errorDetail }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
