import { describe, expect, it, vi } from 'vitest';
import { MONITOR, mountPageAt, stubClient } from '../test-support.js';

describe('MonitorsPage', () => {
  it('lists the monitors, each linking to its page', async () => {
    const wrapper = await mountPageAt('/', stubClient());

    const link = wrapper.find('a[href="/monitors/mon_1"]');
    expect(link.text()).toBe('Docs');
    expect(wrapper.text()).toContain(MONITOR.url);
  });

  it('renders a hostile monitor name as text', async () => {
    const client = stubClient({ listMonitors: vi.fn(() => Promise.resolve([{ ...MONITOR, name: '<script>alert(1)</script>' }])) });

    const wrapper = await mountPageAt('/', client);

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
  });
});
