import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import type { ApiClient, Probe } from '../api/client.js';
import { apiClientKey } from '../injection.js';
import { createAppRouter } from '../router.js';
import { MONITOR, pageOf, stubClient } from '../test-support.js';
import ProbeHistoryTable from './ProbeHistoryTable.vue';

const PROBE: Probe = {
  id: 'probe_1',
  slot: 1,
  startedAt: '2026-10-22T12:00:00.000Z',
  latencyMs: 40,
  outcome: 'up',
  errorDetail: null,
  serverName: 'docs',
  serverVersion: '1.0.0',
  snapshotHash: 'c'.repeat(64),
};

async function table(client: ApiClient, path = `/monitors/${MONITOR.id}?tab=probes`) {
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  const wrapper = mount(ProbeHistoryTable, { props: { monitorId: MONITOR.id }, global: { plugins: [router], provide: { [apiClientKey as symbol]: client } } });
  await flushPromises();
  return { wrapper, router };
}

describe('ProbeHistoryTable', () => {
  it('lists time, outcome, latency, server and detail of each probe', async () => {
    const failed: Probe = { ...PROBE, id: 'probe_2', outcome: 'timeout', latencyMs: 5000, errorDetail: 'No answer in 5 s', serverName: null, serverVersion: null };
    const { wrapper } = await table(stubClient({ listProbes: vi.fn(() => Promise.resolve(pageOf([PROBE, failed]))) }));

    const [healthy, timedOut] = wrapper.findAll('tbody tr');
    expect(healthy?.text()).toContain('Up');
    expect(healthy?.text()).toContain('40 ms');
    expect(healthy?.text()).toContain('docs 1.0.0');
    expect(timedOut?.text()).toContain('Timeout');
    expect(timedOut?.text()).toContain('No answer in 5 s');
  });

  it('asks for the probes of its monitor', async () => {
    const listProbes = vi.fn(() => Promise.resolve(pageOf([PROBE])));

    await table(stubClient({ listProbes }));

    expect(listProbes).toHaveBeenCalledWith(MONITOR.id, expect.objectContaining({ cursor: null, limit: 20 }));
  });

  it('shows the range against the total and moves on with the cursor the API gave', async () => {
    const listProbes = vi.fn().mockResolvedValueOnce(pageOf([PROBE, { ...PROBE, id: 'probe_2' }], 'cursor_2', 5)).mockResolvedValue(pageOf([PROBE], null, 5));
    const { wrapper, router } = await table(stubClient({ listProbes }));

    expect(wrapper.text()).toContain('Showing 1-2 of 5');
    await wrapper.find('button[data-action="next"]').trigger('click');
    await flushPromises();

    expect(listProbes).toHaveBeenLastCalledWith(MONITOR.id, expect.objectContaining({ cursor: 'cursor_2' }));
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'probes', page: '2', cursor: 'cursor_2' });
  });

  it('keeps the full error text on hover while the cell is cut short', async () => {
    const detail = 'x'.repeat(300);
    const { wrapper } = await table(stubClient({ listProbes: vi.fn(() => Promise.resolve(pageOf([{ ...PROBE, outcome: 'protocol_error' as const, errorDetail: detail }]))) }));

    expect(wrapper.find('.detail-text').attributes('title')).toBe(detail);
  });

  it('says so when there is nothing to list', async () => {
    const { wrapper } = await table(stubClient());

    expect(wrapper.text()).toContain('Not probed yet');
  });

  it('renders error details and server names as text', async () => {
    const hostile: Probe = { ...PROBE, outcome: 'protocol_error', errorDetail: '<img src=x onerror=alert(1)>', serverName: '<b>docs</b>' };
    const { wrapper } = await table(stubClient({ listProbes: vi.fn(() => Promise.resolve(pageOf([hostile]))) }));

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
    expect(wrapper.text()).toContain('<b>docs</b>');
  });

  it('shows the problem and a retry when the probes cannot be read', async () => {
    const listProbes = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(pageOf([PROBE]));
    const { wrapper } = await table(stubClient({ listProbes }));

    expect(wrapper.find('[role="alert"]').text()).toContain('boom');
    await wrapper.find('button[data-action="retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('40 ms');
  });
});
