import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApiKeyStore } from '../api/api-key-store.js';
import { apiKeyStoreKey } from '../injection.js';
import ApiKeyGate from './ApiKeyGate.vue';

beforeEach(() => {
  window.sessionStorage.clear();
});

function gateOver(store = createApiKeyStore(window.sessionStorage)) {
  const wrapper = mount(ApiKeyGate, {
    slots: { default: '<p>protected content</p>' },
    global: { provide: { [apiKeyStoreKey as symbol]: store } },
  });
  return { wrapper, store };
}

describe('ApiKeyGate', () => {
  it('asks for a key and withholds the content until there is one', () => {
    const { wrapper } = gateOver();

    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('protected content');
  });

  it('saves the key typed in and then shows the content', async () => {
    const { wrapper, store } = gateOver();

    await wrapper.find('input').setValue('key_1');
    await wrapper.find('form').trigger('submit');

    expect(store.key.value).toBe('key_1');
    expect(wrapper.text()).toContain('protected content');
  });

  it('shows the content straight away when the session already holds a key', () => {
    const store = createApiKeyStore(window.sessionStorage);
    store.save('key_1');

    expect(gateOver(store).wrapper.text()).toContain('protected content');
  });

  it('asks again once the key is cleared, as happens when the API rejects it', async () => {
    const store = createApiKeyStore(window.sessionStorage);
    store.save('key_1');
    const { wrapper } = gateOver(store);

    store.clear();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('input').exists()).toBe(true);
  });
});
