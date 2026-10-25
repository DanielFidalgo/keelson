<script setup lang="ts">
import { useRelativeTime } from '../composables/useRelativeTime.js';

const props = defineProps<{ timestamp: string }>();

const { age, absolute } = useRelativeTime(() => props.timestamp);
</script>

<template>
  <time :datetime="timestamp" :title="absolute">{{ age }}</time>
</template>
