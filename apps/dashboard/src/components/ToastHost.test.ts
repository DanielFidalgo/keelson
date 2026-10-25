import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createToasts, toastsKey } from '../composables/useToasts.js';
import ToastHost from './ToastHost.vue';

function host() {
  const toasts = createToasts();
  const wrapper = mount(ToastHost, { global: { provide: { [toastsKey as symbol]: toasts } } });
  return { wrapper, toasts };
}

describe('ToastHost', () => {
  it('keeps one polite live region on the page, with a toast per message and failures marked apart', async () => {
    const { wrapper, toasts } = host();
    expect(wrapper.attributes('role')).toBe('status');
    expect(wrapper.attributes('aria-live')).toBe('polite');

    toasts.success('Monitor paused');
    toasts.failure(new Error('boom'));
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('.toast');
    expect(items.map((item) => item.classes('is-failure'))).toEqual([false, true]);
    expect(items[0]?.text()).toContain('Monitor paused');
    expect(items[1]?.text()).toContain('The request failed: boom');
    // Only the region itself carries a role, not each toast.
    expect(wrapper.findAll('[role]')).toHaveLength(1);
  });

  it('dismisses a toast when its button is pressed', async () => {
    const { wrapper, toasts } = host();
    toasts.success('Monitor paused');
    await wrapper.vm.$nextTick();

    await wrapper.find('button[data-action="dismiss"]').trigger('click');

    expect(wrapper.find('.toast').exists()).toBe(false);
  });

  it('shows text that looks like markup literally', async () => {
    const { wrapper, toasts } = host();

    toasts.success('<img src=x onerror=alert(1)>');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
  });
});
