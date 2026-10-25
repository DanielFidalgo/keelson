import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createApiKeyStore } from '../api/api-key-store.js';
import { apiKeyStoreKey } from '../injection.js';
import { createAppRouter } from '../router.js';
import AppSidebar from './AppSidebar.vue';

const FULL_KEY = 'kls_0123456789abcdefa3f9';

beforeEach(() => {
  window.sessionStorage.clear();
});

async function sidebar(counts: { monitorCount: number | null; openIncidentCount: number | null; webhookCount: number | null }, path = '/monitors') {
  const store = createApiKeyStore(window.sessionStorage);
  store.save(FULL_KEY);
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  const wrapper = mount(AppSidebar, { props: counts, global: { plugins: [router], provide: { [apiKeyStoreKey as symbol]: store } } });
  return { wrapper, store };
}

const COUNTS = { monitorCount: 19, openIncidentCount: 2, webhookCount: 1 };

describe('AppSidebar', () => {
  it('shows the counts it is given next to each section', async () => {
    const { wrapper } = await sidebar(COUNTS);

    expect(wrapper.find('a[href="/monitors"]').text()).toContain('19');
    expect(wrapper.find('a[href="/incidents"]').text()).toContain('2 open');
    expect(wrapper.find('a[href="/webhooks"]').text()).toContain('1');
  });

  it('shows no badge for a count that is not known yet, and none for zero open incidents', async () => {
    const { wrapper } = await sidebar({ monitorCount: null, openIncidentCount: 0, webhookCount: null });

    expect(wrapper.find('a[href="/monitors"]').text()).toBe('Monitors');
    expect(wrapper.find('a[href="/incidents"]').text()).toBe('Incidents');
    expect(wrapper.find('a[href="/webhooks"]').text()).toBe('Webhooks');
  });

  it('highlights the section being viewed, including a monitor opened from the list', async () => {
    const { wrapper } = await sidebar(COUNTS, '/monitors/mon_1');

    expect(wrapper.find('a[href="/monitors"]').classes()).toContain('is-active');
    expect(wrapper.find('a[href="/incidents"]').classes()).not.toContain('is-active');
    expect(wrapper.find('a[href="/"]').classes()).not.toContain('is-active');
  });

  it('opens the API reference in a new tab without handing over the opener', async () => {
    const { wrapper } = await sidebar(COUNTS);

    const link = wrapper.find('a[href="/reference/"]');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener');
  });

  it('shows the key masked to its last 4 characters', async () => {
    const { wrapper } = await sidebar(COUNTS);

    expect(wrapper.text()).toContain('a3f9');
    expect(wrapper.text()).not.toContain(FULL_KEY);
    expect(wrapper.text()).not.toContain('0123456789');
  });

  it('signs out by clearing the key from the session storage', async () => {
    const { wrapper, store } = await sidebar(COUNTS);

    await wrapper.find('button[data-action="sign-out"]').trigger('click');

    expect(window.sessionStorage.getItem('keelson.apiKey')).toBeNull();
    expect(store.key.value).toBeNull();
  });
});
