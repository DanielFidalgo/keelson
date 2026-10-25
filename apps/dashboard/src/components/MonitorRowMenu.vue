<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import type { MonitorWithSummary } from '../api/client.js';

const props = defineProps<{ monitor: MonitorWithSummary }>();

const emit = defineEmits<{ approve: []; pause: []; resume: []; delete: [] }>();

const MENU_GAP_PX = 4;

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const placement = ref({ top: '0px', right: '0px' });

const isDrifted = computed(() => props.monitor.summary.health === 'drift');
const isPaused = computed(() => props.monitor.status === 'paused');
const items = () => Array.from(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

// The table scrolls sideways, which clips an absolutely positioned menu, so it is placed against the viewport instead.
// It opens above the button when there is no room below.
async function place(): Promise<void> {
  const button = trigger.value?.getBoundingClientRect();
  if (button === undefined) return;
  placement.value = { top: `${String(button.bottom + MENU_GAP_PX)}px`, right: `${String(window.innerWidth - button.right)}px` };
  await nextTick();
  const height = menu.value?.offsetHeight ?? 0;
  if (button.bottom + MENU_GAP_PX + height > window.innerHeight) placement.value.top = `${String(button.top - MENU_GAP_PX - height)}px`;
}

async function show(): Promise<void> {
  open.value = true;
  await place();
  items()[0]?.focus();
}

function close(): void {
  open.value = false;
}

function closeAndRefocus(): void {
  close();
  trigger.value?.focus();
}

function toggle(): void {
  if (open.value) close();
  else void show();
}

function moveFocus(step: 1 | -1): void {
  const entries = items();
  const current = entries.indexOf(document.activeElement as HTMLElement);
  entries[(current + step + entries.length) % entries.length]?.focus();
}

function handleKeydown(event: KeyboardEvent): void {
  if (!open.value) return;
  if (event.key === 'Escape') closeAndRefocus();
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveFocus(event.key === 'ArrowDown' ? 1 : -1);
  }
}

// A null relatedTarget is a click on something unfocusable, which the pointerdown listener handles; reacting to it here would
// close the menu before a click on its own button could toggle it.
function closeWhenFocusLeaves(event: FocusEvent): void {
  const destination = event.relatedTarget;
  if (destination instanceof Node && !root.value?.contains(destination)) close();
}

function closeWhenPointerLeaves(event: Event): void {
  if (!root.value?.contains(event.target as Node)) close();
}

// Listeners exist only while the menu is open, so a table of rows does not carry one set per row.
function listenForDismissal(listening: boolean): void {
  const method = listening ? 'addEventListener' : 'removeEventListener';
  window[method]('pointerdown', closeWhenPointerLeaves);
  window[method]('resize', close);
  // Captured, because the table scrolls rather than the window.
  window[method]('scroll', close, true);
}

watch(open, listenForDismissal);
onBeforeUnmount(() => {
  listenForDismissal(false);
});
</script>

<template>
  <div ref="root" class="row-menu" @keydown="handleKeydown" @focusout="closeWhenFocusLeaves">
    <button ref="trigger" type="button" class="btn btn-small row-menu-trigger" aria-haspopup="menu" :aria-expanded="open" :aria-label="`Actions for ${monitor.name}`" @click="toggle">⋯</button>
    <div v-if="open" ref="menu" class="row-menu-list" role="menu" :style="placement">
      <RouterLink v-if="isDrifted" role="menuitem" class="row-menu-item" :to="{ name: 'monitor', params: { id: monitor.id }, query: { tab: 'drift' } }" @click="close">Review drift</RouterLink>
      <button v-if="isDrifted" type="button" role="menuitem" class="row-menu-item" @click="closeAndRefocus(); emit('approve')">Approve new baseline</button>
      <RouterLink role="menuitem" class="row-menu-item" :to="{ name: 'monitor', params: { id: monitor.id }, query: { tab: 'probes' } }" @click="close">Probe history</RouterLink>
      <button v-if="isPaused" type="button" role="menuitem" class="row-menu-item" @click="closeAndRefocus(); emit('resume')">Resume monitoring</button>
      <button v-else type="button" role="menuitem" class="row-menu-item" @click="closeAndRefocus(); emit('pause')">Pause monitoring</button>
      <hr class="row-menu-separator" />
      <button type="button" role="menuitem" class="row-menu-item is-danger" @click="closeAndRefocus(); emit('delete')">Delete monitor</button>
    </div>
  </div>
</template>

<style scoped>
.row-menu {
  display: inline-block;
}

.row-menu-trigger {
  color: var(--scalar-color-3);
  line-height: 1;
}

.row-menu-list {
  position: fixed;
  z-index: 10;
  width: 190px;
  padding: var(--space-1);
  border: 1px solid var(--scalar-border-color);
  border-radius: var(--radius-lg);
  background: var(--scalar-background-2);
  box-shadow: var(--shadow-overlay);
  text-align: left;
}

.row-menu-item {
  display: block;
  width: 100%;
  padding: 6px var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--scalar-color-1);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.row-menu-item:hover,
.row-menu-item:focus-visible {
  background: var(--scalar-background-3);
  text-decoration: none;
}

.row-menu-item:focus-visible {
  outline-offset: -2px;
}

.row-menu-item.is-danger {
  color: var(--scalar-color-red-text);
}

.row-menu-separator {
  margin: var(--space-1) 0;
  border: 0;
  border-top: 1px solid var(--scalar-border-color);
}
</style>
