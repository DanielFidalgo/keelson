import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { MONITOR, MONITOR_WITH_SUMMARY, mountPageAt, pageOf, stubClient } from '../test-support.js';

describe('MonitorsPage', () => {
  it('lists the monitors with their health, each linking to its page', async () => {
    const wrapper = await mountPageAt('/monitors', stubClient());

    const link = wrapper.find('a[href="/monitors/mon_1"]');
    expect(link.text()).toBe('Docs');
    expect(wrapper.text()).toContain(MONITOR.url);
    expect(wrapper.find('.status-pill').text()).toBe('Up');
    expect(wrapper.text()).toContain('Showing 1-1 of 1');
  });

  it('renders a hostile monitor name as text', async () => {
    const hostile = { ...MONITOR_WITH_SUMMARY, name: '<script>alert(1)</script>' };
    const client = stubClient({ listMonitors: vi.fn(() => Promise.resolve(pageOf([hostile]))) });

    const wrapper = await mountPageAt('/monitors', client);

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
  });

  it('asks the API for the next page with the cursor it was given', async () => {
    const listMonitors = vi.fn().mockResolvedValueOnce(pageOf([MONITOR_WITH_SUMMARY], 'after_1', 2)).mockResolvedValue(pageOf([], null, 2));
    const wrapper = await mountPageAt('/monitors', stubClient({ listMonitors }));

    await wrapper.find('button[data-action="next"]').trigger('click');
    await flushPromises();

    expect(listMonitors).toHaveBeenLastCalledWith({ cursor: 'after_1', limit: 20 });
  });
});
