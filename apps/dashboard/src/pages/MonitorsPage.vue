<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { formatTime } from '../format.js';
import { useApiClient } from '../injection.js';
import { useLoadedData } from '../composables/useLoadedData.js';

const client = useApiClient();
const { data: monitors, errorMessage } = useLoadedData(() => client.listMonitors());
</script>

<template>
  <h1>Monitors</h1>
  <p v-if="errorMessage !== null" role="alert" class="error">{{ errorMessage }}</p>
  <p v-else-if="monitors === null">Loading...</p>
  <p v-else-if="monitors.length === 0">No monitors yet.</p>
  <table v-else>
    <thead>
      <tr>
        <th>Name</th>
        <th>URL</th>
        <th>Status</th>
        <th>Baseline</th>
        <th>Failures in a row</th>
        <th>Next probe</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="monitor in monitors" :key="monitor.id">
        <td>
          <RouterLink :to="{ name: 'monitor', params: { id: monitor.id } }">{{ monitor.name }}</RouterLink>
        </td>
        <td>{{ monitor.url }}</td>
        <td>{{ monitor.status }}</td>
        <td>{{ monitor.baselineHash === null ? 'Awaiting first probe' : 'Approved' }}</td>
        <td>{{ monitor.consecutiveFailures }}</td>
        <td>{{ formatTime(monitor.nextProbeAt) }}</td>
      </tr>
    </tbody>
  </table>
</template>
