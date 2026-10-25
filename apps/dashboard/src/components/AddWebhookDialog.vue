<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';
import type { CreateWebhookEndpointRequest, WebhookEndpoint } from '../api/client.js';
import { describeProblems } from '../api/describe-failure.js';
import { useToasts } from '../composables/useToasts.js';
import { useApiClient } from '../injection.js';
import ModalDialog from './ModalDialog.vue';

const emit = defineEmits<{ close: []; created: [endpoint: WebhookEndpoint] }>();

const FORMATS = [
  ['standard', 'Standard (signed JSON)'],
  ['slack', 'Slack'],
] as const satisfies readonly (readonly [CreateWebhookEndpointRequest['format'], string])[];

const client = useApiClient();
const toasts = useToasts();
const formId = useId();

const url = ref('');
const format = ref<CreateWebhookEndpointRequest['format']>('standard');
const sending = ref(false);
const problems = ref<string[]>([]);
const added = ref(false);
// Held here and nowhere else: the page is told about the endpoint without it, and it goes when this dialog is unmounted.
const signingSecret = ref<string | null>(null);
const doneButton = ref<HTMLButtonElement | null>(null);

async function submit(): Promise<void> {
  if (sending.value) return;
  sending.value = true;
  problems.value = [];
  try {
    const { signingSecret: secret, ...endpoint } = await client.createWebhookEndpoint({ url: url.value, format: format.value });
    signingSecret.value = secret;
    added.value = true;
    emit('created', endpoint);
    // The form that held the focus is gone, and a dialog without focus inside it would not hear Escape.
    await nextTick();
    doneButton.value?.focus();
  } catch (failure) {
    problems.value = describeProblems(failure);
  } finally {
    sending.value = false;
  }
}

async function copySecret(): Promise<void> {
  try {
    await navigator.clipboard.writeText(signingSecret.value ?? '');
    toasts.success('Signing secret copied');
  } catch (failure) {
    toasts.failure(failure);
  }
}
</script>

<template>
  <ModalDialog :title="added ? 'Webhook endpoint added' : 'Add webhook'" :dismissible="!added && !sending" @close="emit('close')">
    <!-- The API is the authority on what is valid, so its messages are shown instead of the browser's. -->
    <form v-if="!added" :id="formId" class="webhook-form" novalidate @submit.prevent="submit">
      <label class="field">
        <span>URL</span>
        <input v-model="url" class="input" name="url" type="url" autocomplete="off" placeholder="https://example.com/hooks/keelson" required data-autofocus />
      </label>
      <label class="field">
        <span>Format</span>
        <select v-model="format" class="input" name="format">
          <option v-for="[value, label] in FORMATS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <div v-if="problems.length > 0" class="error" role="alert">
        <ul class="problems">
          <li v-for="problem in problems" :key="problem">{{ problem }}</li>
        </ul>
      </div>
    </form>
    <div v-else-if="signingSecret !== null" class="secret">
      <p class="notice">Copy the signing secret now. You will not see this again.</p>
      <div class="secret-box">
        <code data-secret>{{ signingSecret }}</code>
        <button type="button" class="btn btn-small" data-action="copy" @click="copySecret">Copy</button>
      </div>
    </div>
    <p v-else class="secret">Slack endpoints are not signed, so there is no signing secret.</p>
    <template #footer>
      <template v-if="!added">
        <button type="button" class="btn" data-action="cancel" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" data-action="submit" :form="formId" :disabled="sending">Add webhook</button>
      </template>
      <button v-else ref="doneButton" type="button" class="btn btn-primary" data-action="done" @click="emit('close')">Done</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.webhook-form,
.secret {
  display: grid;
  gap: var(--space-3);
}

.secret {
  margin: 0;
}

.field {
  display: grid;
  gap: var(--space-1);
  color: var(--scalar-color-2);
}

.problems {
  margin: 0;
  padding-left: var(--space-4);
}

.notice {
  margin: 0;
  padding: var(--space-2) 10px;
  border: 1px solid color-mix(in srgb, var(--scalar-color-yellow) 25%, transparent);
  border-radius: var(--radius);
  background: var(--status-warning-background);
  color: var(--scalar-color-yellow);
}

.secret-box {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 10px;
  border: 1px solid var(--scalar-border-color);
  border-radius: var(--radius);
  background: var(--scalar-background-1);
}

.secret-box code {
  flex: 1;
  color: var(--scalar-color-1);
  overflow-wrap: anywhere;
  user-select: all;
}
</style>
