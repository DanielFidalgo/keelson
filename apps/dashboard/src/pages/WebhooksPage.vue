<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import AddWebhookDialog from '../components/AddWebhookDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import DataList from '../components/DataList.vue';
import ListPagination from '../components/ListPagination.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusPill from '../components/StatusPill.vue';
import type { WebhookEndpoint } from '../api/client.js';
import { PAGE_SIZES, useListQuery } from '../composables/useListQuery.js';
import { useNavCounts } from '../composables/useNavCounts.js';
import { useToasts } from '../composables/useToasts.js';
import { useApiClient } from '../injection.js';

const COLUMNS = ['Endpoint', 'Format', 'Status', 'Failures', 'Actions'];
const FORMAT_LABELS: Record<WebhookEndpoint['format'], string> = { standard: 'Standard', slack: 'Slack' };
const MASK = '••••';

const client = useApiClient();
const toasts = useToasts();
const navCounts = useNavCounts();

const list = useListQuery({
  defaults: {},
  pageSizes: PAGE_SIZES,
  load: ({ cursor, limit }) => client.listWebhookEndpoints({ cursor, limit }),
});
const addingWebhook = ref(false);
const endpointToDelete = shallowRef<WebhookEndpoint | null>(null);

// Everything after the host is a credential (a Slack URL's path is the secret), and a user, password or query may be one too.
function schemeAndHostOf(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}`;
  } catch {
    return null;
  }
}

function maskedUrl(url: string): string {
  const base = schemeAndHostOf(url);
  return base === null ? MASK : `${base}/${MASK}`;
}

async function afterChange(): Promise<void> {
  await Promise.all([list.refreshAfterChange(), navCounts.refresh()]);
}

async function perform(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
  } catch (failure) {
    toasts.failure(failure);
    return;
  }
  toasts.success(message);
  await afterChange();
}

function setStatus(endpoint: WebhookEndpoint, status: WebhookEndpoint['status']): Promise<void> {
  return perform(() => client.updateWebhookEndpoint(endpoint.id, { status }), `${status === 'disabled' ? 'Disabled' : 'Enabled'} the webhook endpoint`);
}

function deleteEndpoint(endpoint: WebhookEndpoint): Promise<void> {
  endpointToDelete.value = null;
  return perform(() => client.deleteWebhookEndpoint(endpoint.id), 'Deleted the webhook endpoint');
}

// The dialog stays open to show the signing secret, so only the list behind it is brought up to date.
function noteAdded(): Promise<void> {
  toasts.success('Added the webhook endpoint');
  return afterChange();
}
</script>

<template>
  <PageHeader title="Webhooks">
    <button type="button" class="btn" data-action="refresh" @click="list.refresh()">Refresh</button>
    <button type="button" class="btn btn-primary" data-action="add-webhook" @click="addingWebhook = true">+ Add webhook</button>
  </PageHeader>
  <DataList
    :columns="COLUMNS"
    :loading="list.loading"
    :error="list.error"
    :is-empty="list.items.length === 0"
    empty-title="No webhook endpoints yet"
    empty-hint="Add one to be told when a monitor drifts or goes down."
    @retry="list.refresh()"
  >
    <tr v-for="endpoint in list.items" :key="endpoint.id">
      <td class="mono" data-cell="url">{{ maskedUrl(endpoint.url) }}</td>
      <td>
        <span class="badge">{{ FORMAT_LABELS[endpoint.format] }}</span>
      </td>
      <td><StatusPill :health="endpoint.status === 'active' ? 'up' : 'paused'" :label="endpoint.status === 'active' ? 'Active' : 'Disabled'" /></td>
      <td data-cell="failures">{{ endpoint.consecutiveFailures }}</td>
      <td class="actions-cell">
        <button v-if="endpoint.status === 'active'" type="button" class="btn btn-small" data-action="disable" @click="setStatus(endpoint, 'disabled')">Disable</button>
        <button v-else type="button" class="btn btn-small" data-action="enable" @click="setStatus(endpoint, 'active')">Enable</button>
        <button type="button" class="btn btn-small" data-action="delete" @click="endpointToDelete = endpoint">Delete</button>
      </td>
    </tr>
  </DataList>
  <ListPagination
    :range-label="list.rangeLabel"
    :page-size="list.pageSize"
    :page-sizes="PAGE_SIZES"
    :has-previous="list.hasPrevious"
    :has-next="list.hasNext"
    @previous="list.previous()"
    @next="list.next()"
    @update:page-size="list.setPageSize($event)"
  />
  <AddWebhookDialog v-if="addingWebhook" @close="addingWebhook = false" @created="noteAdded" />
  <ConfirmDialog
    v-if="endpointToDelete !== null"
    title="Delete webhook endpoint"
    :body="`Delete the webhook endpoint at ${schemeAndHostOf(endpointToDelete.url) ?? MASK}? Nothing will be sent to it again, and this cannot be undone.`"
    confirm-label="Delete"
    danger
    @cancel="endpointToDelete = null"
    @confirm="deleteEndpoint(endpointToDelete)"
  />
</template>

<style scoped>
.actions-cell {
  text-align: right;
  white-space: nowrap;
}

.actions-cell .btn + .btn {
  margin-left: var(--space-2);
}
</style>
