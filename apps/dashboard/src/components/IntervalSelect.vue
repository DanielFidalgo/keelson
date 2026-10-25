<script setup lang="ts">
import { computed } from 'vue';
import { INTERVAL_MINUTES, SECONDS_PER_MINUTE, minutesOf } from '../intervals.js';

const props = defineProps<{ modelValue: number }>();

const emit = defineEmits<{ 'update:modelValue': [seconds: number] }>();

// An interval set through the API can fall outside the choices; listing it keeps the form from showing, and then saving, another one.
const minuteOptions = computed(() => {
  const current = minutesOf(props.modelValue);
  return INTERVAL_MINUTES.includes(current) ? INTERVAL_MINUTES : [...INTERVAL_MINUTES, current].sort((a, b) => a - b);
});

function report(event: Event): void {
  emit('update:modelValue', Number((event.target as HTMLSelectElement).value) * SECONDS_PER_MINUTE);
}
</script>

<template>
  <label class="interval-field">
    <span>Probe every</span>
    <select class="input" name="interval" :value="minutesOf(modelValue)" @change="report">
      <option v-for="minutes in minuteOptions" :key="minutes" :value="minutes">{{ minutes }} minutes</option>
    </select>
    <span class="hint">Deployed monitors are probed on the quarter hour, so 5 minutes only takes effect in demo mode.</span>
  </label>
</template>

<style scoped>
.interval-field {
  display: grid;
  gap: var(--space-1);
  color: var(--scalar-color-2);
}
</style>
