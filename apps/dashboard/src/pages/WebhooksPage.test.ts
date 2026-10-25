import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient, CreatedWebhookEndpoint, WebhookEndpoint } from '../api/client.js';
import { createNavCounts } from '../composables/useNavCounts.js';
import { createToasts } from '../composables/useToasts.js';
import { mountPageAt, pageOf, stubClient } from '../test-support.js';

type Mounted = Awaited<ReturnType<typeof mountPageAt>>;

const SLACK_PATH = '/services/T000/B000/s3cr3tTokenValue';
const SLACK: WebhookEndpoint = {
  id: 'whe_slack',
  url: `https://hooks.slack.com${SLACK_PATH}`,
  format: 'slack',
  status: 'active',
  consecutiveFailures: 0,
  createdAt: '2026-10-22T12:00:00.000Z',
};
const STANDARD: WebhookEndpoint = {
  id: 'whe_standard',
  url: 'https://ops.example.com:8443/hooks/keelson?token=abc123',
  format: 'standard',
  status: 'disabled',
  consecutiveFailures: 3,
  createdAt: '2026-10-22T12:00:00.000Z',
};
const SECRET = 'whsec_0123456789abcdef';

const listing = (...endpoints: WebhookEndpoint[]) => vi.fn(() => Promise.resolve(pageOf(endpoints)));
const buttonIn = (wrapper: Mounted, action: string, row = 0) => wrapper.findAll(`button[data-action="${action}"]`)[row];

function environment(client = stubClient()) {
  const toasts = createToasts();
  const refreshNavCounts = vi.fn(() => Promise.resolve());
  const navCounts = { ...createNavCounts(client), refresh: refreshNavCounts };
  return { toasts, navCounts, refreshNavCounts };
}

async function openAddDialog(wrapper: Mounted) {
  await wrapper.find('button[data-action="add-webhook"]').trigger('click');
}

async function addEndpoint(wrapper: Mounted, url: string) {
  await openAddDialog(wrapper);
  await wrapper.find('input[name="url"]').setValue(url);
  await wrapper.find('form').trigger('submit');
  await flushPromises();
}

describe('WebhooksPage', () => {
  describe('the list', () => {
    it('shows each endpoint with its format, status and consecutive failures', async () => {
      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints: listing(SLACK, STANDARD) }));

      const rows = wrapper.findAll('tbody tr').map((row) => row.text());
      expect(rows[0]).toContain('Slack');
      expect(rows[0]).toContain('Active');
      expect(rows[1]).toContain('Standard');
      expect(rows[1]).toContain('Disabled');
      expect(wrapper.findAll('[data-cell="failures"]').map((cell) => cell.text())).toEqual(['0', '3']);
      expect(wrapper.text()).toContain('Showing 1-2 of 2');
    });

    it('shows only the scheme and host of a Slack URL, never its path', async () => {
      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints: listing(SLACK) }));

      expect(wrapper.find('[data-cell="url"]').text()).toContain('https://hooks.slack.com');
      expect(wrapper.html()).not.toContain('s3cr3tTokenValue');
      expect(wrapper.html()).not.toContain(SLACK_PATH);
    });

    it('shows only the scheme and host of any other URL, keeping its port and hiding path, query and credentials', async () => {
      const withCredentials = { ...STANDARD, url: 'https://usern4me:p4ssw0rd@ops.example.com:8443/p4thsegment?t0ken=qu3ry#fr4gment' };

      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints: listing(withCredentials) }));

      expect(wrapper.find('[data-cell="url"]').text()).toContain('https://ops.example.com:8443');
      for (const hidden of ['usern4me', 'p4ssw0rd', 'p4thsegment', 'qu3ry', 'fr4gment']) expect(wrapper.html()).not.toContain(hidden);
    });

    it('hides the whole value when the URL cannot be read, rather than showing it', async () => {
      const unreadable = { ...STANDARD, url: 'not a url but still zzhidden' };

      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints: listing(unreadable) }));

      expect(wrapper.html()).not.toContain('zzhidden');
    });

    it('says so when there are no endpoints', async () => {
      const wrapper = await mountPageAt('/webhooks', stubClient());

      expect(wrapper.text()).toContain('No webhook endpoints yet');
    });

    it('offers to retry when the list cannot be loaded', async () => {
      const listWebhookEndpoints = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(pageOf([SLACK]));
      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints }));
      expect(wrapper.find('[role="alert"]').text()).toContain('offline');

      await buttonIn(wrapper, 'retry')?.trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-cell="url"]').exists()).toBe(true);
    });

    it('asks the API for the next page with the cursor it was given', async () => {
      const listWebhookEndpoints = vi.fn().mockResolvedValueOnce(pageOf([SLACK], 'after_1', 2)).mockResolvedValue(pageOf([STANDARD], null, 2));
      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints }));

      await wrapper.find('button[data-action="next"]').trigger('click');
      await flushPromises();

      expect(listWebhookEndpoints).toHaveBeenLastCalledWith({ cursor: 'after_1', limit: 20 });
    });
  });

  describe('adding an endpoint', () => {
    const created: CreatedWebhookEndpoint = { ...STANDARD, status: 'active', signingSecret: SECRET };

    it('shows the signing secret once, and it is gone after the dialog closes', async () => {
      const createWebhookEndpoint = vi.fn(() => Promise.resolve(created));
      const wrapper = await mountPageAt('/webhooks', stubClient({ createWebhookEndpoint }));

      await addEndpoint(wrapper, created.url);
      expect(wrapper.find('[data-secret]').text()).toBe(SECRET);
      expect(wrapper.text()).toContain('You will not see this again');

      await buttonIn(wrapper, 'done')?.trigger('click');

      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(wrapper.html()).not.toContain(SECRET);
      await openAddDialog(wrapper);
      expect(wrapper.html()).not.toContain(SECRET);
    });

    it('reloads the list, the sidebar counts and toasts once the endpoint exists, while the secret stays on screen', async () => {
      const listWebhookEndpoints = vi.fn().mockResolvedValueOnce(pageOf([])).mockResolvedValue(pageOf([created]));
      const client = stubClient({ listWebhookEndpoints, createWebhookEndpoint: vi.fn(() => Promise.resolve(created)) });
      const { toasts, navCounts, refreshNavCounts } = environment(client);
      const wrapper = await mountPageAt('/webhooks', client, { toasts, navCounts });

      await addEndpoint(wrapper, created.url);

      expect(listWebhookEndpoints).toHaveBeenCalledTimes(2);
      expect(refreshNavCounts).toHaveBeenCalledOnce();
      expect(toasts.toasts.value.map(({ text }) => text)).toEqual(['Added the webhook endpoint']);
      expect(wrapper.find('[data-secret]').text()).toBe(SECRET);
      expect(wrapper.find('[data-cell="url"]').exists()).toBe(true);
    });

    it('never puts the secret in a toast', async () => {
      const toasts = createToasts();
      const wrapper = await mountPageAt('/webhooks', stubClient({ createWebhookEndpoint: vi.fn(() => Promise.resolve(created)) }), { toasts });

      await addEndpoint(wrapper, created.url);

      expect(JSON.stringify(toasts.toasts.value)).not.toContain(SECRET);
    });

    it('closes without a trace when cancelled', async () => {
      const createWebhookEndpoint = vi.fn(() => Promise.resolve(created));
      const wrapper = await mountPageAt('/webhooks', stubClient({ createWebhookEndpoint }));
      await openAddDialog(wrapper);

      await buttonIn(wrapper, 'cancel')?.trigger('click');

      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(createWebhookEndpoint).not.toHaveBeenCalled();
    });
  });

  describe('enabling and disabling', () => {
    it('disables an active endpoint by sending status disabled', async () => {
      const updateWebhookEndpoint = vi.fn(() => Promise.resolve(SLACK));
      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints: listing(SLACK), updateWebhookEndpoint }));

      await buttonIn(wrapper, 'disable')?.trigger('click');
      await flushPromises();

      expect(updateWebhookEndpoint).toHaveBeenCalledWith(SLACK.id, { status: 'disabled' });
    });

    it('enables a disabled endpoint by sending status active', async () => {
      const updateWebhookEndpoint = vi.fn(() => Promise.resolve(STANDARD));
      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints: listing(STANDARD), updateWebhookEndpoint }));

      await buttonIn(wrapper, 'enable')?.trigger('click');
      await flushPromises();

      expect(updateWebhookEndpoint).toHaveBeenCalledWith(STANDARD.id, { status: 'active' });
    });

    it('offers Disable on active rows and Enable on disabled ones', async () => {
      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints: listing(SLACK, STANDARD) }));

      expect(wrapper.findAll('button[data-action="disable"]')).toHaveLength(1);
      expect(wrapper.findAll('button[data-action="enable"]')).toHaveLength(1);
    });

    it('tells the user, reloads and refreshes the sidebar counts', async () => {
      const listWebhookEndpoints = listing(SLACK);
      const client = stubClient({ listWebhookEndpoints, updateWebhookEndpoint: vi.fn(() => Promise.resolve(SLACK)) });
      const { toasts, navCounts, refreshNavCounts } = environment(client);
      const wrapper = await mountPageAt('/webhooks', client, { toasts, navCounts });

      await buttonIn(wrapper, 'disable')?.trigger('click');
      await flushPromises();

      expect(toasts.toasts.value.map(({ text }) => text)).toEqual(['Disabled the webhook endpoint']);
      expect(listWebhookEndpoints).toHaveBeenCalledTimes(2);
      expect(refreshNavCounts).toHaveBeenCalledOnce();
    });

    it('disables the row buttons while the update runs, so a double click sends it once', async () => {
      let finishUpdate!: () => void;
      const updateWebhookEndpoint = vi.fn(
        () =>
          new Promise<WebhookEndpoint>((resolve) => {
            finishUpdate = () => {
              resolve(SLACK);
            };
          }),
      );
      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints: listing(SLACK), updateWebhookEndpoint }));

      await buttonIn(wrapper, 'disable')?.trigger('click');
      await buttonIn(wrapper, 'disable')?.trigger('click');

      expect(updateWebhookEndpoint).toHaveBeenCalledOnce();
      expect(buttonIn(wrapper, 'disable')?.attributes('disabled')).toBeDefined();
      expect(buttonIn(wrapper, 'delete')?.attributes('disabled')).toBeDefined();
      finishUpdate();
      await flushPromises();
      expect(buttonIn(wrapper, 'disable')?.attributes('disabled')).toBeUndefined();
    });

    it('shows the problem as a toast when the update fails', async () => {
      const client = stubClient({ listWebhookEndpoints: listing(SLACK), updateWebhookEndpoint: vi.fn(() => Promise.reject(new Error('offline'))) });
      const toasts = createToasts();
      const wrapper = await mountPageAt('/webhooks', client, { toasts });

      await buttonIn(wrapper, 'disable')?.trigger('click');
      await flushPromises();

      expect(toasts.toasts.value.map(({ kind }) => kind)).toEqual(['failure']);
    });
  });

  describe('deleting', () => {
    it('asks first, naming the host and not the path, and deletes nothing yet', async () => {
      const deleteWebhookEndpoint = vi.fn(() => Promise.resolve());
      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints: listing(SLACK), deleteWebhookEndpoint }));

      await buttonIn(wrapper, 'delete')?.trigger('click');

      const dialog = wrapper.find('[role="dialog"]');
      expect(dialog.text()).toContain('https://hooks.slack.com');
      expect(dialog.text()).not.toContain('s3cr3tTokenValue');
      expect(deleteWebhookEndpoint).not.toHaveBeenCalled();
    });

    it('deletes after confirmation, tells the user, reloads and refreshes the sidebar counts', async () => {
      const deleteWebhookEndpoint = vi.fn(() => Promise.resolve());
      const listWebhookEndpoints = vi.fn().mockResolvedValueOnce(pageOf([SLACK])).mockResolvedValue(pageOf([]));
      const client = stubClient({ listWebhookEndpoints, deleteWebhookEndpoint });
      const { toasts, navCounts, refreshNavCounts } = environment(client);
      const wrapper = await mountPageAt('/webhooks', client, { toasts, navCounts });
      await buttonIn(wrapper, 'delete')?.trigger('click');

      await buttonIn(wrapper, 'confirm')?.trigger('click');
      await flushPromises();

      expect(deleteWebhookEndpoint).toHaveBeenCalledWith(SLACK.id);
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('No webhook endpoints yet');
      expect(toasts.toasts.value.map(({ text }) => text)).toEqual(['Deleted the webhook endpoint']);
      expect(refreshNavCounts).toHaveBeenCalledOnce();
    });

    it('does nothing when cancelled', async () => {
      const deleteWebhookEndpoint = vi.fn(() => Promise.resolve());
      const wrapper = await mountPageAt('/webhooks', stubClient({ listWebhookEndpoints: listing(SLACK), deleteWebhookEndpoint }));
      await buttonIn(wrapper, 'delete')?.trigger('click');

      await buttonIn(wrapper, 'cancel')?.trigger('click');

      expect(deleteWebhookEndpoint).not.toHaveBeenCalled();
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    });

    it('shows the problem as a toast when deleting fails', async () => {
      const client: ApiClient = stubClient({ listWebhookEndpoints: listing(SLACK), deleteWebhookEndpoint: vi.fn(() => Promise.reject(new Error('offline'))) });
      const toasts = createToasts();
      const wrapper = await mountPageAt('/webhooks', client, { toasts });
      await buttonIn(wrapper, 'delete')?.trigger('click');

      await buttonIn(wrapper, 'confirm')?.trigger('click');
      await flushPromises();

      expect(toasts.toasts.value.map(({ kind }) => kind)).toEqual(['failure']);
    });

    it('steps back a page when deleting the only row of the last page empties it', async () => {
      const listWebhookEndpoints = vi
        .fn()
        .mockResolvedValueOnce(pageOf([SLACK], null, 21))
        .mockResolvedValueOnce(pageOf([], null, 20))
        .mockResolvedValue(pageOf([STANDARD], 'after_1', 20));
      const wrapper = await mountPageAt('/webhooks?page=2&cursor=after_1', stubClient({ listWebhookEndpoints }));
      await buttonIn(wrapper, 'delete')?.trigger('click');

      await buttonIn(wrapper, 'confirm')?.trigger('click');
      await flushPromises();

      expect(listWebhookEndpoints).toHaveBeenLastCalledWith({ cursor: null, limit: 20 });
      expect(wrapper.vm.$router.currentRoute.value.query).toEqual({});
    });
  });
});
