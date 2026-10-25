import { ref } from 'vue';
import { useNavCounts } from './useNavCounts.js';
import { useToasts } from './useToasts.js';

// What every change a page makes has in common: tell the user how it went, then bring the page and the sidebar counts up to
// date. `busy` lets the buttons that start an action stay disabled while it runs, so a double click cannot send it twice.
export function useAction(refreshView: () => Promise<unknown>) {
  const toasts = useToasts();
  const navCounts = useNavCounts();
  const busy = ref(false);

  async function completed(message: string): Promise<void> {
    toasts.success(message);
    await Promise.all([refreshView(), navCounts.refresh()]);
  }

  async function attempt(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (failure) {
      toasts.failure(failure);
      return false;
    }
  }

  // Returns whether the action went through, so a caller can leave its own state alone when it did not.
  async function perform(action: () => Promise<unknown>, successMessage: string): Promise<boolean> {
    busy.value = true;
    try {
      const succeeded = await attempt(action);
      if (succeeded) await completed(successMessage);
      return succeeded;
    } finally {
      busy.value = false;
    }
  }

  return { busy, perform, completed };
}
