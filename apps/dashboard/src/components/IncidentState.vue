<script setup lang="ts">
import type { IncidentView } from '../api/client.js';
import { INCIDENT_STATE_LABELS, RESOLUTION_LABELS } from '../labels.js';
import RelativeTime from './RelativeTime.vue';
import StatusPill from './StatusPill.vue';

const props = defineProps<{ incident: IncidentView }>();

// An incident resolved before resolutions were recorded has none, and is still resolved.
const resolutionLabel = (): string => (props.incident.resolution === null ? INCIDENT_STATE_LABELS.resolved : RESOLUTION_LABELS[props.incident.resolution]);
</script>

<template>
  <StatusPill v-if="incident.state === 'resolved'" health="resolved" :label="resolutionLabel()" />
  <template v-else-if="incident.acknowledgedAt !== null">{{ INCIDENT_STATE_LABELS.acknowledged }} <RelativeTime class="text-secondary" :timestamp="incident.acknowledgedAt" /></template>
  <template v-else>{{ INCIDENT_STATE_LABELS.open }}</template>
</template>
