import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { stubClient } from '../test-support.js';
import { useAction } from './useAction.js';
import { createNavCounts, navCountsKey } from './useNavCounts.js';
import { createToasts, toastsKey } from './useToasts.js';

function mountAction() {
  const toasts = createToasts();
  const refreshNavCounts = vi.fn(() => Promise.resolve());
  const refreshView = vi.fn(() => Promise.resolve());
  const navCounts = { ...createNavCounts(stubClient()), refresh: refreshNavCounts };
  let action!: ReturnType<typeof useAction>;
  const host = defineComponent({
    setup() {
      action = useAction(refreshView);
      return () => h('div');
    },
  });
  mount(host, { global: { provide: { [toastsKey as symbol]: toasts, [navCountsKey as symbol]: navCounts } } });
  return { action, toasts, refreshView, refreshNavCounts };
}

const texts = (toasts: ReturnType<typeof createToasts>) => toasts.toasts.value.map(({ text }) => text);

describe('useAction', () => {
  it('toasts the success, then refreshes the view and the navigation counts', async () => {
    const { action, toasts, refreshView, refreshNavCounts } = mountAction();

    const succeeded = await action.perform(() => Promise.resolve(), 'Paused Docs');

    expect(succeeded).toBe(true);
    expect(texts(toasts)).toEqual(['Paused Docs']);
    expect(refreshView).toHaveBeenCalledOnce();
    expect(refreshNavCounts).toHaveBeenCalledOnce();
  });

  it('toasts the failure and refreshes nothing', async () => {
    const { action, toasts, refreshView, refreshNavCounts } = mountAction();

    const succeeded = await action.perform(() => Promise.reject(new Error('offline')), 'Paused Docs');

    expect(succeeded).toBe(false);
    expect(toasts.toasts.value.map(({ kind }) => kind)).toEqual(['failure']);
    expect(refreshView).not.toHaveBeenCalled();
    expect(refreshNavCounts).not.toHaveBeenCalled();
  });

  it('is busy from the start of the action until the view is refreshed', async () => {
    const { action, refreshView } = mountAction();
    let finishAction!: () => void;
    let finishRefresh!: () => void;
    refreshView.mockReturnValueOnce(new Promise<void>((resolve) => (finishRefresh = resolve)));

    const running = action.perform(() => new Promise<void>((resolve) => (finishAction = resolve)), 'Done');
    expect(action.busy.value).toBe(true);
    finishAction();
    await flushPromises();
    expect(action.busy.value).toBe(true);
    finishRefresh();
    await running;

    expect(action.busy.value).toBe(false);
  });

  it('is no longer busy after a failure', async () => {
    const { action } = mountAction();

    await action.perform(() => Promise.reject(new Error('offline')), 'Done');

    expect(action.busy.value).toBe(false);
  });

  it('toasts and refreshes for a change made elsewhere, such as a dialog', async () => {
    const { action, toasts, refreshView, refreshNavCounts } = mountAction();

    await action.completed('Added Docs');

    expect(texts(toasts)).toEqual(['Added Docs']);
    expect(refreshView).toHaveBeenCalledOnce();
    expect(refreshNavCounts).toHaveBeenCalledOnce();
  });
});
