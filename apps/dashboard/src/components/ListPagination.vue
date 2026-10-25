<script setup lang="ts">
defineProps<{ rangeLabel: string; pageSize: number; pageSizes: readonly number[]; hasPrevious: boolean; hasNext: boolean }>();

const emit = defineEmits<{ previous: []; next: []; 'update:pageSize': [size: number] }>();

function reportSize(event: Event): void {
  emit('update:pageSize', Number((event.target as HTMLSelectElement).value));
}
</script>

<template>
  <footer class="list-pagination">
    <span>{{ rangeLabel }}</span>
    <select class="input" aria-label="Rows per page" @change="reportSize">
      <option v-for="size in pageSizes" :key="size" :value="size" :selected="size === pageSize">{{ size }} per page</option>
    </select>
    <div class="pager">
      <button type="button" class="btn" data-action="previous" :disabled="!hasPrevious" @click="emit('previous')">‹ Previous</button>
      <button type="button" class="btn" data-action="next" :disabled="!hasNext" @click="emit('next')">Next ›</button>
    </div>
  </footer>
</template>

<style scoped>
.list-pagination {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: auto;
  padding: var(--space-3) 18px;
  border-top: 1px solid var(--scalar-border-color);
  color: var(--scalar-color-3);
}

.pager {
  display: flex;
  gap: var(--space-2);
  margin-left: auto;
}
</style>
