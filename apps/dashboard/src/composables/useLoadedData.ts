import { ref, shallowRef } from 'vue';
import { describeFailure } from '../api/describe-failure.js';

// Loads a dialog's or tab's data once on creation, showing a failed request as text instead of leaving it empty.
export function useLoadedData<Data>(load: () => Promise<Data>) {
  const data = shallowRef<Data | null>(null);
  const errorMessage = ref<string | null>(null);

  async function reload(): Promise<void> {
    try {
      data.value = await load();
      errorMessage.value = null;
    } catch (error) {
      errorMessage.value = describeFailure(error);
    }
  }

  void reload();

  return { data, errorMessage };
}
