<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <header class="page-header">
    <h1>{{ title }}</h1>
    <div class="page-header-actions"><slot /></div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--scalar-border-color);
}

h1 {
  flex: 1;
  margin: 0;
  font-size: var(--font-size-title);
  font-weight: 600;
}

.page-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
