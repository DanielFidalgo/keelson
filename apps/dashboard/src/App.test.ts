import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createApiKeyStore } from './api/api-key-store.js';
import App from './App.vue';
import { createToasts, toastsKey } from './composables/useToasts.js';
import { apiClientKey, apiKeyStoreKey } from './injection.js';
import { createAppRouter } from './router.js';
import { MONITOR_WITH_SUMMARY, stubClient } from './test-support.js';

beforeEach(() => {
  window.sessionStorage.clear();
});

async function app(key: string | null) {
  const store = createApiKeyStore(window.sessionStorage);
  if (key !== null) store.save(key);
  const getMonitor = vi.fn(() => Promise.resolve(MONITOR_WITH_SUMMARY));
  const getHealthCounts = vi.fn(() => Promise.resolve({ total: 19, up: 17, drift: 1, down: 1, paused: 0, pending: 0 }));
  const client = stubClient({
    getMonitor,
    getHealthCounts,
    getIncidentCounts: vi.fn(() => Promise.resolve({ open: 1, acknowledged: 0, resolved: 4, drift: 1, down: 0 })),
  });
  const router = createAppRouter(createMemoryHistory());
  await router.push('/monitors');
  const wrapper = mount(App, {
    global: { plugins: [router], provide: { [apiClientKey as symbol]: client, [apiKeyStoreKey as symbol]: store, [toastsKey as symbol]: createToasts() } },
  });
  await flushPromises();
  return { wrapper, getHealthCounts, getMonitor, router };
}

describe('App', () => {
  it('asks for the key before showing the console, and calls the API only after', async () => {
    const { wrapper, getHealthCounts } = await app(null);

    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('nav').exists()).toBe(false);
    expect(getHealthCounts).not.toHaveBeenCalled();
  });

  it('shows the sidebar with the counts from the API beside the current page', async () => {
    const { wrapper } = await app('kls_key_1234');

    expect(wrapper.find('a[href="/monitors"]').text()).toContain('19');
    expect(wrapper.find('a[href="/incidents"]').text()).toContain('1 open');
    expect(wrapper.find('main h1').text()).toBe('Monitors');
  });

  it('loads the next monitor when only the id in the path changes', async () => {
    const { getMonitor, router } = await app('kls_key_1234');
    await router.push('/monitors/mon_1');
    await flushPromises();

    await router.push('/monitors/mon_2');
    await flushPromises();

    expect(getMonitor).toHaveBeenLastCalledWith('mon_2');
  });
});
