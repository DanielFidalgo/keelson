import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HealthCounts, IncidentView, MonitorListParams, MonitorWithSummary } from '../api/client.js';
import { REFRESH_MS } from '../composables/useListQuery.js';
import { MONITOR_WITH_SUMMARY, mountPageAt, OPEN_DRIFT_INCIDENT, pageOf, stubClient, SUMMARY } from '../test-support.js';

const HEALTH_COUNTS: HealthCounts = { total: 19, up: 16, drift: 2, down: 1, paused: 0, pending: 0 };
const ACKNOWLEDGED_INCIDENT: IncidentView = { ...OPEN_DRIFT_INCIDENT, id: 'inc_2', monitorId: 'mon_2', monitorName: 'Search', acknowledgedAt: '2026-10-22T12:01:00.000Z' };
const DOWN_MONITOR: MonitorWithSummary = {
  ...MONITOR_WITH_SUMMARY,
  id: 'mon_down',
  name: 'Exa',
  summary: { ...SUMMARY, health: 'down', openIncident: { id: 'inc_9', kind: 'down', severity: null } },
};
const DRIFT_MONITOR: MonitorWithSummary = {
  ...MONITOR_WITH_SUMMARY,
  id: 'mon_drift',
  name: 'Context7',
  summary: { ...SUMMARY, health: 'drift', openIncident: { id: 'inc_8', kind: 'drift', severity: 'warning' } },
};

afterEach(() => {
  vi.useRealTimers();
});

function overviewClient({ down = [DOWN_MONITOR], drift = [DRIFT_MONITOR], incidents = [OPEN_DRIFT_INCIDENT, ACKNOWLEDGED_INCIDENT] } = {}) {
  const listMonitors = vi.fn(({ health }: MonitorListParams) => Promise.resolve(pageOf(health === 'down' ? down : drift)));
  const listIncidents = vi.fn(() => Promise.resolve(pageOf(incidents)));
  const getHealthCounts = vi.fn(() => Promise.resolve(HEALTH_COUNTS));
  return { listMonitors, listIncidents, getHealthCounts, client: stubClient({ listMonitors, listIncidents, getHealthCounts }) };
}

const counter = (wrapper: Awaited<ReturnType<typeof mountPageAt>>, name: string) => wrapper.find(`[data-counter="${name}"]`);

describe('OverviewPage', () => {
  it('shows the four counters from the health counts', async () => {
    const wrapper = await mountPageAt('/', overviewClient().client);

    expect(counter(wrapper, 'monitors').text()).toBe('Monitors19');
    expect(counter(wrapper, 'up').text()).toBe('Up16');
    expect(counter(wrapper, 'drift').text()).toBe('Drifted2');
    expect(counter(wrapper, 'down').text()).toBe('Down1');
  });

  it('links each counter to the monitors it counts', async () => {
    const wrapper = await mountPageAt('/', overviewClient().client);

    expect(counter(wrapper, 'monitors').attributes('href')).toBe('/monitors');
    expect(counter(wrapper, 'up').attributes('href')).toBe('/monitors?health=up');
    expect(counter(wrapper, 'drift').attributes('href')).toBe('/monitors?health=drift');
    expect(counter(wrapper, 'down').attributes('href')).toBe('/monitors?health=down');
  });

  it('lists up to 5 open incidents, acknowledged ones included and marked', async () => {
    const { client, listIncidents } = overviewClient();

    const wrapper = await mountPageAt('/', client);

    expect(listIncidents).toHaveBeenCalledWith({ state: 'open', limit: 5 });
    const rows = wrapper.findAll('[data-incident]').map((row) => row.text());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Docs');
    expect(rows[0]).not.toContain('Acknowledged');
    expect(rows[1]).toContain('Search');
    expect(rows[1]).toContain('Acknowledged');
  });

  it('words the state of an incident as the Incidents page does, with no badge of its own', async () => {
    const { client } = overviewClient();

    const wrapper = await mountPageAt('/', client);

    const states = wrapper.findAll('[data-incident] [data-cell="state"]').map((cell) => cell.text());
    expect(states[0]).toBe('Open');
    expect(states[1]).toMatch(/^Acknowledged/);
    expect(wrapper.find('.badge').exists()).toBe(false);
  });

  it('links each incident to its monitor and the section to all incidents', async () => {
    const wrapper = await mountPageAt('/', overviewClient().client);

    expect(wrapper.find('[data-incident] a[href="/monitors/mon_1"]').text()).toBe('Docs');
    expect(wrapper.find('a[href="/incidents"]').exists()).toBe(true);
  });

  it('asks for the down and the drifted monitors in two calls of 10, and lists both', async () => {
    const { client, listMonitors } = overviewClient();

    const wrapper = await mountPageAt('/', client);

    expect(listMonitors).toHaveBeenCalledWith({ health: 'down', limit: 10 });
    expect(listMonitors).toHaveBeenCalledWith({ health: 'drift', limit: 10 });
    expect(listMonitors).toHaveBeenCalledTimes(2);
    const rows = wrapper.findAll('[data-monitor]');
    expect(rows.map((row) => row.find('a').text())).toEqual(['Exa', 'Context7']);
    expect(rows.map((row) => row.find('.status-pill').text())).toEqual(['Down', 'Drift · warning']);
    expect(rows[0]?.find('a').attributes('href')).toBe('/monitors/mon_down');
  });

  it('says so when nothing is open and nothing is down or drifted', async () => {
    const wrapper = await mountPageAt('/', overviewClient({ down: [], drift: [], incidents: [] }).client);

    expect(wrapper.text()).toContain('No open incidents');
    expect(wrapper.text()).toContain('No monitor is down or drifted');
  });

  it('renders hostile names literally', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { client } = overviewClient({
      down: [{ ...DOWN_MONITOR, name: hostile }],
      drift: [],
      incidents: [{ ...OPEN_DRIFT_INCIDENT, monitorName: hostile }],
    });

    const wrapper = await mountPageAt('/', client);

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.findAll('[data-incident], [data-monitor]').map((row) => row.text())).toEqual([expect.stringContaining(hostile), expect.stringContaining(hostile)]);
  });

  it('shows the problem with a Retry when something cannot be loaded, and recovers', async () => {
    const { client, getHealthCounts } = overviewClient();
    getHealthCounts.mockRejectedValueOnce(new Error('offline'));
    const wrapper = await mountPageAt('/', client);
    expect(wrapper.find('[role="alert"]').text()).toContain('offline');
    expect(counter(wrapper, 'up').exists()).toBe(false);

    await wrapper.find('button[data-action="retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(counter(wrapper, 'up').exists()).toBe(true);
  });

  it('keeps the last data on screen under the error when a refresh fails', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { client, getHealthCounts } = overviewClient();
    const wrapper = await mountPageAt('/', client);
    getHealthCounts.mockRejectedValueOnce(new Error('offline'));

    await vi.advanceTimersByTimeAsync(REFRESH_MS);

    expect(wrapper.find('[role="alert"]').text()).toContain('offline');
    expect(counter(wrapper, 'up').text()).toBe('Up16');
    expect(wrapper.findAll('[data-incident]')).toHaveLength(2);
    expect(wrapper.findAll('[data-monitor]')).toHaveLength(2);
  });

  it('drops the error banner once a retry succeeds and keeps the data', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { client, getHealthCounts } = overviewClient();
    const wrapper = await mountPageAt('/', client);
    getHealthCounts.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(REFRESH_MS);

    await wrapper.find('button[data-action="retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(counter(wrapper, 'up').exists()).toBe(true);
  });

  it('reloads every minute while the tab is visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { client, getHealthCounts } = overviewClient();
    await mountPageAt('/', client);

    await vi.advanceTimersByTimeAsync(REFRESH_MS);

    expect(getHealthCounts).toHaveBeenCalledTimes(2);
  });
});
