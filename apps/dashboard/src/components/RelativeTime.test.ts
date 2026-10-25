import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RelativeTime from './RelativeTime.vue';

const NOW = '2026-10-22T12:00:00.000Z';

// The shared clock only stops when every user of it has unmounted.
enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW), toFake: ['Date', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RelativeTime', () => {
  it('renders the age as text and the absolute UTC time as the title', () => {
    const wrapper = mount(RelativeTime, { props: { timestamp: '2026-10-22T11:58:00.000Z' } });

    expect(wrapper.find('time').exists()).toBe(true);
    expect(wrapper.text()).toBe('2 min ago');
    expect(wrapper.attributes('title')).toBe('2026-10-22 11:58:00 UTC');
    expect(wrapper.attributes('datetime')).toBe('2026-10-22T11:58:00.000Z');
  });

  it('moves on as time passes without the timestamp changing', async () => {
    const wrapper = mount(RelativeTime, { props: { timestamp: '2026-10-22T11:58:00.000Z' } });

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(wrapper.text()).toBe('7 min ago');
  });

  it('stops ticking once unmounted', () => {
    const wrapper = mount(RelativeTime, { props: { timestamp: NOW } });

    wrapper.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
