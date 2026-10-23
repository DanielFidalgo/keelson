import { readonly, ref, type Ref } from 'vue';

const STORAGE_ITEM = 'keelson.apiKey';

export interface ApiKeyStore {
  readonly key: Readonly<Ref<string | null>>;
  save(key: string): void;
  clear(): void;
}

// sessionStorage ends with the tab, so the key is not left behind on a shared machine the way localStorage would.
export function createApiKeyStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): ApiKeyStore {
  const key = ref<string | null>(storage.getItem(STORAGE_ITEM));
  return {
    key: readonly(key),
    save(newKey) {
      storage.setItem(STORAGE_ITEM, newKey);
      key.value = newKey;
    },
    clear() {
      storage.removeItem(STORAGE_ITEM);
      key.value = null;
    },
  };
}
