<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue';

// A dialog that holds something unrecoverable sets this to false, so only its own buttons can close it.
const props = withDefaults(defineProps<{ title: string; dismissible?: boolean }>(), { dismissible: true });

const emit = defineEmits<{ close: [] }>();

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const titleId = useId();
const dialog = ref<HTMLElement | null>(null);
let opener: Element | null = null;

function focusableElements(): HTMLElement[] {
  return Array.from(dialog.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
}

onMounted(() => {
  opener = document.activeElement;
  const preferred = dialog.value?.querySelector<HTMLElement>('[data-autofocus]');
  (preferred ?? focusableElements()[0])?.focus();
});

onBeforeUnmount(() => {
  if (opener instanceof HTMLElement) opener.focus();
});

// The dialog itself is focusable (tabindex -1) so that a click on its plain text keeps the key events here, where Escape and
// this trap are handled. Without the trap, Tab would walk out of the dialog into a page the user cannot see or use.
function keepFocusInside(event: KeyboardEvent): void {
  const [first] = focusableElements();
  const last = focusableElements().at(-1);
  const leavingBackwards = event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value);
  const leavingForwards = !event.shiftKey && document.activeElement === last;
  if (leavingBackwards) last?.focus();
  else if (leavingForwards) first?.focus();
  if (leavingBackwards || leavingForwards) event.preventDefault();
}

function dismiss(): void {
  if (props.dismissible) emit('close');
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') dismiss();
  else if (event.key === 'Tab') keepFocusInside(event);
}
</script>

<template>
  <div class="modal-backdrop" @mousedown.self.prevent @click.self="dismiss">
    <div ref="dialog" class="modal" role="dialog" aria-modal="true" tabindex="-1" :aria-labelledby="titleId" @keydown="handleKeydown">
      <h2 :id="titleId" class="modal-title">{{ title }}</h2>
      <div class="modal-body"><slot /></div>
      <div v-if="$slots['footer']" class="modal-footer"><slot name="footer" /></div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  background: var(--backdrop-color);
}

.modal {
  width: 100%;
  max-width: 440px;
  max-height: 100%;
  overflow-y: auto;
  border: 1px solid var(--scalar-border-color);
  border-radius: 10px;
  background: var(--scalar-background-2);
  box-shadow: var(--shadow-overlay);
}

.modal:focus {
  outline: none;
}

.modal-title {
  margin: 0;
  padding: var(--space-4) var(--space-4) 0;
  font-size: var(--font-size-title);
  font-weight: 600;
}

.modal-body {
  padding: var(--space-3) var(--space-4) var(--space-4);
  color: var(--scalar-color-2);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--scalar-border-color);
}
</style>
