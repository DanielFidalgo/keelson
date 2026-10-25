<script setup lang="ts">
import ModalDialog from './ModalDialog.vue';

defineProps<{ title: string; body: string; confirmLabel: string; danger?: boolean }>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <ModalDialog :title="title" @close="emit('cancel')">
    <p class="confirm-body">{{ body }}</p>
    <template #footer>
      <!-- A dangerous action starts on Cancel, so an Enter pressed in a hurry cannot confirm it. -->
      <button type="button" class="btn" data-action="cancel" :data-autofocus="danger ? '' : undefined" @click="emit('cancel')">Cancel</button>
      <button type="button" class="btn" :class="danger ? 'btn-danger' : 'btn-primary'" data-action="confirm" :data-autofocus="danger ? undefined : ''" @click="emit('confirm')">
        {{ confirmLabel }}
      </button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.confirm-body {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
