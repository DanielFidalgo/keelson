<script setup lang="ts">
import { computed } from 'vue';
import type { HealthState } from '../api/client.js';
import { HEALTH_LABELS, INCIDENT_STATE_LABELS } from '../labels.js';

const props = defineProps<{ health: HealthState | 'resolved'; severity?: 'critical' | 'warning' | null; label?: string }>();

type Tone = 'success' | 'critical' | 'warning' | 'danger' | 'neutral';

const PLAIN_LABELS: Record<HealthState | 'resolved', string> = { ...HEALTH_LABELS, resolved: INCIDENT_STATE_LABELS.resolved };

// A drift incident without a severity is treated as critical, the safer reading of an unknown.
const tone = computed<Tone>(() => {
  switch (props.health) {
    case 'up':
      return 'success';
    case 'down':
      return 'danger';
    case 'drift':
      return props.severity === 'warning' ? 'warning' : 'critical';
    default:
      return 'neutral';
  }
});

const text = computed(() => {
  if (props.label !== undefined) return props.label;
  if (props.health === 'drift' && props.severity) return `${PLAIN_LABELS.drift} · ${props.severity}`;
  return PLAIN_LABELS[props.health];
});
</script>

<template>
  <span class="status-pill" :data-tone="tone"><span class="status-dot" aria-hidden="true" />{{ text }}</span>
</template>

<style scoped>
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--tone-background);
  color: var(--tone-color);
  font-size: var(--font-size-small);
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentcolor;
}

.status-pill[data-tone='success'] {
  --tone-background: var(--status-success-background);
  --tone-color: var(--scalar-color-green);
}

.status-pill[data-tone='critical'] {
  --tone-background: var(--status-critical-background);
  --tone-color: var(--scalar-color-orange);
}

.status-pill[data-tone='warning'] {
  --tone-background: var(--status-warning-background);
  --tone-color: var(--scalar-color-yellow);
}

.status-pill[data-tone='danger'] {
  --tone-background: var(--status-danger-background);
  --tone-color: var(--scalar-color-red-text);
}

.status-pill[data-tone='neutral'] {
  --tone-background: var(--scalar-background-3);
  --tone-color: var(--scalar-color-2);
}
</style>
