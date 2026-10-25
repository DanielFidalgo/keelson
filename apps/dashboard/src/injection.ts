import { inject, type InjectionKey } from 'vue';
import type { ApiKeyStore } from './api/api-key-store.js';
import type { ApiClient } from './api/client.js';

export const apiClientKey: InjectionKey<ApiClient> = Symbol('apiClient');
export const apiKeyStoreKey: InjectionKey<ApiKeyStore> = Symbol('apiKeyStore');

export function required<Value>(key: InjectionKey<Value>, name: string): Value {
  const value = inject(key);
  if (value === undefined) throw new Error(`${name} was not provided to the app`);
  return value;
}

export const useApiClient = (): ApiClient => required(apiClientKey, 'the API client');
export const useApiKeyStore = (): ApiKeyStore => required(apiKeyStoreKey, 'the API key store');
