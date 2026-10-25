<script setup lang="ts">
defineProps<{ columns: readonly string[]; loading: boolean; error: string | null; isEmpty: boolean; emptyTitle: string; emptyHint?: string }>();

defineEmits<{ retry: [] }>();

const SKELETON_ROWS = 6;
// Uneven widths read as text being loaded, where identical bars read as a fault.
const SKELETON_WIDTHS = ['70%', '45%', '60%', '35%', '55%'];

const skeletonWidth = (row: number, column: number): string => SKELETON_WIDTHS[(row + column) % SKELETON_WIDTHS.length] ?? '50%';
</script>

<template>
  <div class="data-list" :aria-busy="loading">
    <div v-if="error !== null" class="list-state" role="alert">
      <p class="list-state-title">Could not load this list</p>
      <p class="list-state-detail">{{ error }}</p>
      <button type="button" class="btn" data-action="retry" @click="$emit('retry')">Retry</button>
    </div>
    <div v-else-if="isEmpty && !loading" class="list-state">
      <p class="list-state-title">{{ emptyTitle }}</p>
      <p v-if="emptyHint !== undefined" class="list-state-detail">{{ emptyHint }}</p>
    </div>
    <div v-else class="table-scroll">
      <table class="data-table" :class="{ 'is-refreshing': loading && !isEmpty }">
        <thead>
          <tr>
            <th v-for="(column, index) in columns" :key="index" scope="col">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-if="isEmpty">
            <tr v-for="row in SKELETON_ROWS" :key="row" class="skeleton-row">
              <td v-for="(_column, index) in columns" :key="index"><span class="skeleton" :style="{ width: skeletonWidth(row, index) }" /></td>
            </tr>
          </template>
          <slot v-else />
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.list-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: 56px var(--space-5);
  text-align: center;
}

.list-state p {
  margin: 0;
}

.list-state-title {
  font-size: 14px;
  font-weight: 600;
}

.list-state-detail {
  max-width: 48ch;
  color: var(--scalar-color-2);
  overflow-wrap: anywhere;
}

.list-state[role='alert'] .list-state-title {
  color: var(--scalar-color-red-text);
}
</style>
