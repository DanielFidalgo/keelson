import { ref, shallowRef } from 'vue';
import { ApiError } from '../api/client.js';

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? `The request failed: ${error.message}` : 'The request failed.';
}

// Loads a page's data once on creation and again after each change the page makes, showing a failed request as text
// instead of leaving the page empty.
export function useLoadedData<Data>(load: () => Promise<Data>) {
  const data = shallowRef<Data | null>(null);
  const errorMessage = ref<string | null>(null);
  const busy = ref(false);

  async function reload(): Promise<void> {
    try {
      data.value = await load();
      errorMessage.value = null;
    } catch (error) {
      errorMessage.value = messageOf(error);
    }
  }

  async function change(apply: () => Promise<unknown>): Promise<void> {
    busy.value = true;
    try {
      await apply();
      await reload();
    } catch (error) {
      errorMessage.value = messageOf(error);
    } finally {
      busy.value = false;
    }
  }

  void reload();

  return { data, errorMessage, busy, change };
}
