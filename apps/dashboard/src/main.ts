import { createApp } from 'vue';
import { createApiKeyStore } from './api/api-key-store.js';
import { createApiClient } from './api/client.js';
import App from './App.vue';
import { createToasts, toastsKey } from './composables/useToasts.js';
import { apiClientKey, apiKeyStoreKey } from './injection.js';
import { createAppRouter } from './router.js';
import './style.css';

const apiKeyStore = createApiKeyStore(window.sessionStorage);
// The API answers 401 for a key it rejects; forgetting it sends the user back to the key prompt.
const apiClient = createApiClient({ apiKey: () => apiKeyStore.key.value, onUnauthorized: () => { apiKeyStore.clear(); } });

createApp(App)
  .use(createAppRouter())
  .provide(apiClientKey, apiClient)
  .provide(apiKeyStoreKey, apiKeyStore)
  .provide(toastsKey, createToasts())
  .mount('#app');
