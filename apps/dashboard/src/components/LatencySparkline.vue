<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ values: (number | null)[] }>();

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const HEIGHT = 16;
// Even a near-zero latency stays visible as a bar.
const MIN_BAR_HEIGHT = 3;
const BAR_STEP = BAR_WIDTH + BAR_GAP;

const width = computed(() => props.values.length * BAR_STEP - BAR_GAP);

const bars = computed(() => {
  const slowest = Math.max(1, ...props.values.map((value) => value ?? 0));
  return props.values.map((value, index) => {
    const failed = value === null;
    const height = failed ? HEIGHT : Math.max(MIN_BAR_HEIGHT, Math.round((value / slowest) * HEIGHT));
    return { x: index * BAR_STEP, y: HEIGHT - height, height, failed, tooltip: failed ? 'failed' : `${String(value)} ms` };
  });
});
</script>

<template>
  <svg v-if="values.length > 0" class="sparkline" role="img" :aria-label="`Latency of the last ${values.length} probes`" :width="width" :height="HEIGHT" :viewBox="`0 0 ${width} ${HEIGHT}`">
    <rect v-for="(bar, index) in bars" :key="index" class="sparkline-bar" :class="{ 'is-failed': bar.failed }" :x="bar.x" :y="bar.y" :width="BAR_WIDTH" :height="bar.height" rx="1">
      <title>{{ bar.tooltip }}</title>
    </rect>
  </svg>
</template>

<style scoped>
.sparkline {
  display: inline-block;
  vertical-align: middle;
}

.sparkline-bar {
  fill: var(--scalar-color-accent);
  opacity: 0.6;
}

.sparkline-bar:hover {
  opacity: 1;
}

.sparkline-bar.is-failed {
  fill: var(--scalar-color-red-text);
  opacity: 1;
}
</style>
