<script setup lang="ts">
import { useToasts } from '../composables/useToasts.js';

const { toasts, dismiss } = useToasts();
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <!-- The live region stays in the page, because one inserted together with its message is often not announced. -->
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`is-${toast.kind}`">
      <span class="toast-text">{{ toast.text }}</span>
      <button type="button" class="toast-dismiss" data-action="dismiss" aria-label="Dismiss" @click="dismiss(toast.id)">×</button>
    </div>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 340px;
  max-width: calc(100vw - 2 * var(--space-4));
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: 10px var(--space-3);
  border: 1px solid var(--scalar-border-color);
  border-left: 3px solid var(--scalar-color-green);
  border-radius: var(--radius-lg);
  background: var(--scalar-background-2);
  box-shadow: var(--shadow-overlay);
}

.toast.is-failure {
  border-left-color: var(--scalar-color-red-text);
}

.toast-text {
  flex: 1;
  overflow-wrap: anywhere;
}

.toast-dismiss {
  padding: 0 var(--space-1);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--scalar-color-3);
  font-size: 16px;
  line-height: 1.2;
  cursor: pointer;
}

.toast-dismiss:hover {
  color: var(--scalar-color-1);
}
</style>
