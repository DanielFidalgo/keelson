<script setup lang="ts">
import ApiKeyGate from './components/ApiKeyGate.vue';
import AppShell from './components/AppShell.vue';
import ToastHost from './components/ToastHost.vue';
</script>

<template>
  <ApiKeyGate><AppShell /></ApiKeyGate>
  <ToastHost />
</template>
