<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useLoadedData } from '../composables/useLoadedData.js';
import { formatTime } from '../format.js';
import { useApiClient } from '../injection.js';

const client = useApiClient();
const { data, errorMessage, busy, change } = useLoadedData(async () => {
  const [incidents, monitors] = await Promise.all([client.listOpenIncidents(), client.listMonitors()]);
  const monitorNames = new Map(monitors.map(({ id, name }) => [id, name]));
  return incidents.map((incident) => ({ incident, monitorName: monitorNames.get(incident.monitorId) ?? incident.monitorId }));
});

function acknowledge(incidentId: string): Promise<void> {
  return change(() => client.acknowledgeIncident(incidentId));
}
</script>

<template>
  <h1>Open incidents</h1>
  <p v-if="errorMessage !== null" role="alert" class="error">{{ errorMessage }}</p>
  <p v-else-if="data === null">Loading...</p>
  <p v-else-if="data.length === 0">No open incidents.</p>
  <table v-else>
    <thead>
      <tr>
        <th>Monitor</th>
        <th>Kind</th>
        <th>Opened</th>
        <th>Acknowledgement</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="{ incident, monitorName } in data" :key="incident.id">
        <td>
          <RouterLink :to="{ name: 'monitor', params: { id: incident.monitorId } }">{{ monitorName }}</RouterLink>
        </td>
        <td>{{ incident.kind }}</td>
        <td>{{ formatTime(incident.openedAt) }}</td>
        <td>
          <template v-if="incident.acknowledgedAt !== null">Acknowledged {{ formatTime(incident.acknowledgedAt) }}</template>
          <button v-else type="button" data-action="acknowledge" :disabled="busy" @click="acknowledge(incident.id)">Acknowledge</button>
        </td>
      </tr>
    </tbody>
  </table>
</template>
