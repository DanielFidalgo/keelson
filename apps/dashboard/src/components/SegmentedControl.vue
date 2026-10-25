<script setup lang="ts">
export interface SegmentOption {
  value: string | null;
  label: string;
  count?: number;
}

defineProps<{ label: string; modelValue: string | null; options: readonly SegmentOption[] }>();

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>();
</script>

<template>
  <div class="segmented" role="group" :aria-label="label">
    <button v-for="option in options" :key="option.value ?? ''" type="button" :aria-pressed="option.value === modelValue" @click="emit('update:modelValue', option.value)">
      {{ option.label }}<span v-if="option.count !== undefined" class="segmented-count">{{ option.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--scalar-border-color);
  border-radius: 7px;
  background: var(--scalar-background-2);
}

button {
  padding: var(--space-1) 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--scalar-color-2);
  cursor: pointer;
  transition: background-color 0.12s, color 0.12s;
}

button:hover {
  color: var(--scalar-color-1);
}

button[aria-pressed='true'] {
  background: var(--scalar-background-3);
  color: var(--scalar-color-1);
}

.segmented-count {
  margin-left: var(--space-1);
  color: var(--scalar-color-3);
  font-weight: 500;
}
</style>
