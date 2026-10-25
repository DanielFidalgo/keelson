<script setup lang="ts">
defineProps<{ message: string; showingPrevious: boolean }>();

defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="error-banner error" role="alert">
    <span>{{ message }}<template v-if="showingPrevious"> Showing what was loaded before.</template></span>
    <button type="button" class="btn" data-action="retry" @click="$emit('retry')">Retry</button>
  </div>
</template>

<style scoped>
.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: var(--space-3) 18px;
}
</style>
