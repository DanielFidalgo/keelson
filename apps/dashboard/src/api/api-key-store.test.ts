import { beforeEach, describe, expect, it } from 'vitest';
import { createApiKeyStore } from './api-key-store.js';

const STORAGE_ITEM = 'keelson.apiKey';

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('createApiKeyStore', () => {
  it('keeps the key in sessionStorage and nowhere else', () => {
    const store = createApiKeyStore(window.sessionStorage);

    store.save('key_1');

    expect(window.sessionStorage.getItem(STORAGE_ITEM)).toBe('key_1');
    expect(window.localStorage.length).toBe(0);
    expect(store.key.value).toBe('key_1');
  });

  it('starts with the key a previous page load saved in the session', () => {
    window.sessionStorage.setItem(STORAGE_ITEM, 'key_1');

    expect(createApiKeyStore(window.sessionStorage).key.value).toBe('key_1');
  });

  it('forgets the key when cleared', () => {
    const store = createApiKeyStore(window.sessionStorage);
    store.save('key_1');

    store.clear();

    expect(store.key.value).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_ITEM)).toBeNull();
  });
});
