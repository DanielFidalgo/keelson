import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient, type HealthCounts, type MonitorWithSummary } from '../api/client.js';
import { SEARCH_DEBOUNCE_MS } from '../composables/useListQuery.js';
import { createNavCounts } from '../composables/useNavCounts.js';
import { createToasts } from '../composables/useToasts.js';
import { MONITOR, MONITOR_WITH_SUMMARY, SUMMARY, mountPageAt, pageOf, stubClient } from '../test-support.js';

type Mounted = Awaited<ReturnType<typeof mountPageAt>>;

const HEALTH_COUNTS: HealthCounts = { total: 19, up: 17, drift: 1, down: 1, paused: 0, pending: 0 };
const DRIFTED: MonitorWithSummary = { ...MONITOR_WITH_SUMMARY, summary: { ...SUMMARY, health: 'drift' } };
const PAUSED: MonitorWithSummary = { ...MONITOR_WITH_SUMMARY, status: 'paused', summary: { ...SUMMARY, health: 'paused' } };
const DRIFT_HASH = 'd'.repeat(64);

afterEach(() => {
  vi.useRealTimers();
});

// The client's methods are created here, apart from the client, so the tests can look at their calls.
function trackedClient(overrides: Partial<ApiClient> = {}) {
  const spies = {
    listMonitors: vi.fn(() => Promise.resolve(pageOf([MONITOR_WITH_SUMMARY]))),
    createMonitor: vi.fn(() => Promise.resolve(MONITOR)),
    updateMonitor: vi.fn(() => Promise.resolve(MONITOR)),
    deleteMonitor: vi.fn(() => Promise.resolve()),
    approveBaseline: vi.fn(() => Promise.resolve(MONITOR)),
  };
  return { ...spies, client: stubClient({ ...spies, ...overrides }) };
}

function environment(client = stubClient()) {
  const toasts = createToasts();
  const refreshNavCounts = vi.fn(() => Promise.resolve());
  const navCounts = { ...createNavCounts(client), refresh: refreshNavCounts };
  return { toasts, navCounts, refreshNavCounts };
}

const query = (wrapper: Mounted) => wrapper.vm.$router.currentRoute.value.query;
const segment = (wrapper: Mounted, label: string) => wrapper.findAll('.segmented button').find((button) => button.text().startsWith(label));
const menuItem = (wrapper: Mounted, label: string) => wrapper.findAll('[role="menuitem"]').find((item) => item.text() === label);

async function openRowMenu(wrapper: Mounted, row = 0) {
  await wrapper.findAll('button[aria-haspopup="menu"]')[row]?.trigger('click');
}

async function choose(wrapper: Mounted, label: string, row = 0) {
  await openRowMenu(wrapper, row);
  await menuItem(wrapper, label)?.trigger('click');
  await flushPromises();
}

describe('MonitorsPage', () => {
  it('lists the monitors with their health, each linking to its page', async () => {
    const wrapper = await mountPageAt('/monitors', stubClient());

    const link = wrapper.find('a[href="/monitors/mon_1"]');
    expect(link.text()).toBe('Docs');
    expect(wrapper.text()).toContain(MONITOR.url);
    expect(wrapper.find('.status-pill').text()).toBe('Up');
    expect(wrapper.text()).toContain('3');
    expect(wrapper.text()).toContain('48 ms');
    expect(wrapper.text()).toContain('Showing 1-1 of 1');
  });

  it('words a failed latest probe with the same label as the probe history', async () => {
    const failing = { ...MONITOR_WITH_SUMMARY, summary: { ...SUMMARY, latestProbe: { outcome: 'connection_error' as const, startedAt: '2026-10-22T12:00:00.000Z', latencyMs: 0 } } };

    const wrapper = await mountPageAt('/monitors', stubClient({ listMonitors: vi.fn(() => Promise.resolve(pageOf([failing]))) }));

    expect(wrapper.text()).toContain('Connection error');
  });

  it('renders a hostile monitor name as text', async () => {
    const hostile = { ...MONITOR_WITH_SUMMARY, name: '<img src=x onerror=alert(1)>' };
    const client = stubClient({ listMonitors: vi.fn(() => Promise.resolve(pageOf([hostile]))) });

    const wrapper = await mountPageAt('/monitors', client);
    await openRowMenu(wrapper);
    await menuItem(wrapper, 'Delete monitor')?.trigger('click');

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
    expect(wrapper.find('[role="dialog"]').text()).toContain('<img src=x onerror=alert(1)>');
  });

  it('asks the API for the next page with the cursor it was given', async () => {
    const listMonitors = vi.fn().mockResolvedValueOnce(pageOf([MONITOR_WITH_SUMMARY], 'after_1', 2)).mockResolvedValue(pageOf([], null, 2));
    const wrapper = await mountPageAt('/monitors', stubClient({ listMonitors }));

    await wrapper.find('button[data-action="next"]').trigger('click');
    await flushPromises();

    expect(listMonitors).toHaveBeenLastCalledWith({ health: null, q: null, cursor: 'after_1', limit: 20 });
  });

  describe('filters', () => {
    it('shows each health with its count, and Pending only when something is pending', async () => {
      const getHealthCounts = vi.fn(() => Promise.resolve(HEALTH_COUNTS));
      const wrapper = await mountPageAt('/monitors', stubClient({ getHealthCounts }));

      expect(wrapper.findAll('.segmented button').map((button) => button.text())).toEqual(['All19', 'Up17', 'Drift1', 'Down1', 'Paused0']);

      getHealthCounts.mockResolvedValue({ ...HEALTH_COUNTS, pending: 2 });
      await wrapper.find('button[data-action="refresh"]').trigger('click');
      await flushPromises();

      expect(wrapper.findAll('.segmented button').map((button) => button.text())).toContain('Pending2');
    });

    it('keeps Pending while it is the active filter even if nothing is pending any more', async () => {
      const wrapper = await mountPageAt('/monitors?health=pending', stubClient({ getHealthCounts: () => Promise.resolve(HEALTH_COUNTS) }));

      expect(segment(wrapper, 'Pending')?.attributes('aria-pressed')).toBe('true');
    });

    it('lists without counts when they cannot be read', async () => {
      const wrapper = await mountPageAt('/monitors', stubClient({ getHealthCounts: () => Promise.reject(new Error('down')) }));

      expect(wrapper.findAll('.segmented button').map((button) => button.text())).toEqual(['All', 'Up', 'Drift', 'Down', 'Paused']);
      expect(wrapper.text()).toContain('Docs');
    });

    it('asks for one health, puts it in the URL and starts again from the first page', async () => {
      const listMonitors = vi.fn(() => Promise.resolve(pageOf([DRIFTED], 'after_1', 40)));
      const wrapper = await mountPageAt('/monitors?page=3&cursor=c2', stubClient({ listMonitors }));

      await segment(wrapper, 'Drift')?.trigger('click');
      await flushPromises();

      expect(listMonitors).toHaveBeenLastCalledWith({ health: 'drift', q: null, cursor: null, limit: 20 });
      expect(query(wrapper)).toEqual({ health: 'drift' });
      expect(segment(wrapper, 'Drift')?.attributes('aria-pressed')).toBe('true');
    });

    it('goes back to every monitor on All', async () => {
      const listMonitors = vi.fn(() => Promise.resolve(pageOf([MONITOR_WITH_SUMMARY])));
      const wrapper = await mountPageAt('/monitors?health=down', stubClient({ listMonitors }));

      await segment(wrapper, 'All')?.trigger('click');
      await flushPromises();

      expect(listMonitors).toHaveBeenLastCalledWith({ health: null, q: null, cursor: null, limit: 20 });
      expect(query(wrapper)).toEqual({});
    });

    it('ignores a health in the URL that is not one of the states', async () => {
      const listMonitors = vi.fn(() => Promise.resolve(pageOf([MONITOR_WITH_SUMMARY])));

      await mountPageAt('/monitors?health=sideways', stubClient({ listMonitors }));

      expect(listMonitors).toHaveBeenCalledWith({ health: null, q: null, cursor: null, limit: 20 });
    });

    it('restores the search box and the health from a pasted link', async () => {
      const listMonitors = vi.fn(() => Promise.resolve(pageOf([DRIFTED])));

      const wrapper = await mountPageAt('/monitors?health=drift&q=docs', stubClient({ listMonitors }));

      expect(listMonitors).toHaveBeenCalledWith({ health: 'drift', q: 'docs', cursor: null, limit: 20 });
      expect(wrapper.find<HTMLInputElement>('input[type="search"]').element.value).toBe('docs');
    });

    it('says when nothing matches a filter, as opposed to there being no monitors at all', async () => {
      const empty = stubClient({ listMonitors: () => Promise.resolve(pageOf([])) });

      const filtered = await mountPageAt('/monitors?q=nothing', empty);
      const unfiltered = await mountPageAt('/monitors', empty);

      expect(filtered.text()).toContain('No monitors match');
      expect(unfiltered.text()).toContain('No monitors yet');
    });
  });

  describe('search', () => {
    it('waits for a pause in typing, then searches by text and puts it in the URL', async () => {
      vi.useFakeTimers();
      const listMonitors = vi.fn(() => Promise.resolve(pageOf([MONITOR_WITH_SUMMARY])));
      const wrapper = await mountPageAt('/monitors', stubClient({ listMonitors }));
      const callsBefore = listMonitors.mock.calls.length;

      await wrapper.find('input[type="search"]').setValue('do');
      await wrapper.find('input[type="search"]').setValue('docs');
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
      expect(listMonitors).toHaveBeenCalledTimes(callsBefore);

      await vi.advanceTimersByTimeAsync(1);
      await flushPromises();

      expect(listMonitors).toHaveBeenCalledTimes(callsBefore + 1);
      expect(listMonitors).toHaveBeenLastCalledWith({ health: null, q: 'docs', cursor: null, limit: 20 });
      expect(query(wrapper)).toEqual({ q: 'docs' });
    });

    it('drops the search from the request and the URL when the box is cleared', async () => {
      vi.useFakeTimers();
      const listMonitors = vi.fn(() => Promise.resolve(pageOf([MONITOR_WITH_SUMMARY])));
      const wrapper = await mountPageAt('/monitors?q=docs', stubClient({ listMonitors }));

      await wrapper.find('input[type="search"]').setValue('  ');
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
      await flushPromises();

      expect(listMonitors).toHaveBeenLastCalledWith({ health: null, q: null, cursor: null, limit: 20 });
      expect(query(wrapper)).toEqual({});
    });

    it('follows the URL when the browser goes back to an earlier search', async () => {
      const wrapper = await mountPageAt('/monitors?q=docs', stubClient());

      await wrapper.vm.$router.push('/monitors?q=other');
      await flushPromises();

      expect(wrapper.find<HTMLInputElement>('input[type="search"]').element.value).toBe('other');
    });

    it('limits the text to what the API accepts', async () => {
      const wrapper = await mountPageAt('/monitors', stubClient());

      expect(wrapper.find('input[type="search"]').attributes('maxlength')).toBe('100');
    });
  });

  describe('Add monitor', () => {
    it('opens the dialog from the header', async () => {
      const wrapper = await mountPageAt('/monitors', stubClient());

      await wrapper.find('button[data-action="add-monitor"]').trigger('click');

      expect(wrapper.find('[role="dialog"]').text()).toContain('Add monitor');
    });

    it('closes after a success, tells the user, and refreshes the list and the sidebar counts', async () => {
      const { client, listMonitors, createMonitor } = trackedClient();
      const { toasts, navCounts, refreshNavCounts } = environment(client);
      const wrapper = await mountPageAt('/monitors', client, { toasts, navCounts });
      const listCallsBefore = listMonitors.mock.calls.length;
      await wrapper.find('button[data-action="add-monitor"]').trigger('click');
      await wrapper.find('input[name="name"]').setValue('Docs');
      await wrapper.find('input[name="url"]').setValue('https://mcp.example.com/mcp');

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(createMonitor).toHaveBeenCalledWith({ name: 'Docs', url: 'https://mcp.example.com/mcp', intervalSeconds: 900 });
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(toasts.toasts.value.map((toast) => toast.text)).toEqual(['Added Docs']);
      expect(listMonitors).toHaveBeenCalledTimes(listCallsBefore + 1);
      expect(refreshNavCounts).toHaveBeenCalledOnce();
    });

    it('stays open and changes nothing when the API refuses', async () => {
      const refusal = new ApiError({ type: 'about:blank', title: '', status: 400, detail: 'Invalid request', errors: ['url must be https'] });
      const { client } = trackedClient({ createMonitor: () => Promise.reject(refusal) });
      const { toasts, navCounts, refreshNavCounts } = environment(client);
      const wrapper = await mountPageAt('/monitors', client, { toasts, navCounts });
      await wrapper.find('button[data-action="add-monitor"]').trigger('click');

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.find('[role="alert"]').text()).toContain('url must be https');
      expect(toasts.toasts.value).toEqual([]);
      expect(refreshNavCounts).not.toHaveBeenCalled();
    });
  });

  describe('Approve new baseline', () => {
    const drifting = () => {
      const listMonitors = vi.fn(() => Promise.resolve(pageOf([DRIFTED])));
      const getDrift = vi.fn(() =>
        Promise.resolve({ drift: { fromHash: MONITOR.baselineHash ?? '', toHash: DRIFT_HASH, changes: [{ kind: 'tool_removed' as const, severity: 'critical' as const, name: 'search' }] } }),
      );
      return { ...trackedClient({ listMonitors, getDrift }), listMonitors, getDrift };
    };

    it('reads the drift first and shows the hash before anything is approved', async () => {
      const { client, getDrift, approveBaseline } = drifting();
      const wrapper = await mountPageAt('/monitors', client);

      await choose(wrapper, 'Approve new baseline');

      expect(getDrift).toHaveBeenCalledWith('mon_1');
      expect(wrapper.find('[role="dialog"]').text()).toContain(DRIFT_HASH);
      expect(approveBaseline).not.toHaveBeenCalled();
    });

    it('approves exactly the hash it showed, then tells the user and refreshes', async () => {
      const { client, listMonitors, approveBaseline } = drifting();
      const { toasts, navCounts, refreshNavCounts } = environment(client);
      const wrapper = await mountPageAt('/monitors', client, { toasts, navCounts });
      await choose(wrapper, 'Approve new baseline');
      const listCallsBefore = listMonitors.mock.calls.length;

      await wrapper.find('button[data-action="approve"]').trigger('click');
      await flushPromises();

      expect(approveBaseline).toHaveBeenCalledWith('mon_1', DRIFT_HASH);
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(toasts.toasts.value.map((toast) => toast.text)).toEqual(['Approved the new baseline of Docs']);
      expect(listMonitors).toHaveBeenCalledTimes(listCallsBefore + 1);
      expect(refreshNavCounts).toHaveBeenCalledOnce();
    });

    it('is not offered for a monitor that is not drifted', async () => {
      const wrapper = await mountPageAt('/monitors', stubClient());
      await openRowMenu(wrapper);

      expect(menuItem(wrapper, 'Approve new baseline')).toBeUndefined();
      expect(menuItem(wrapper, 'Review drift')).toBeUndefined();
    });
  });

  describe('Pause and Resume', () => {
    it('pauses an active monitor', async () => {
      const { client, listMonitors, updateMonitor } = trackedClient();
      const { toasts, navCounts, refreshNavCounts } = environment(client);
      const wrapper = await mountPageAt('/monitors', client, { toasts, navCounts });
      const listCallsBefore = listMonitors.mock.calls.length;

      await choose(wrapper, 'Pause monitoring');

      expect(updateMonitor).toHaveBeenCalledWith('mon_1', { status: 'paused' });
      expect(toasts.toasts.value.map((toast) => toast.text)).toEqual(['Paused Docs']);
      expect(listMonitors).toHaveBeenCalledTimes(listCallsBefore + 1);
      expect(refreshNavCounts).toHaveBeenCalledOnce();
    });

    it('resumes a paused monitor', async () => {
      const { client, updateMonitor } = trackedClient({ listMonitors: () => Promise.resolve(pageOf([PAUSED])) });
      const { toasts, navCounts } = environment(client);
      const wrapper = await mountPageAt('/monitors', client, { toasts, navCounts });

      await choose(wrapper, 'Resume monitoring');

      expect(updateMonitor).toHaveBeenCalledWith('mon_1', { status: 'active' });
      expect(toasts.toasts.value.map((toast) => toast.text)).toEqual(['Resumed Docs']);
    });

    it('shows the failure and leaves the list and the counts alone', async () => {
      const refusal = new ApiError({ type: 'about:blank', title: '', status: 404, detail: 'Monitor not found' });
      const { client, listMonitors } = trackedClient({ updateMonitor: () => Promise.reject(refusal) });
      const { toasts, navCounts, refreshNavCounts } = environment(client);
      const wrapper = await mountPageAt('/monitors', client, { toasts, navCounts });
      const listCallsBefore = listMonitors.mock.calls.length;

      await choose(wrapper, 'Pause monitoring');

      expect(toasts.toasts.value).toMatchObject([{ kind: 'failure', text: 'Monitor not found' }]);
      expect(listMonitors).toHaveBeenCalledTimes(listCallsBefore);
      expect(refreshNavCounts).not.toHaveBeenCalled();
    });
  });

  describe('Delete', () => {
    it('asks first, naming the monitor, and deletes nothing until confirmed', async () => {
      const { client, deleteMonitor } = trackedClient();
      const wrapper = await mountPageAt('/monitors', client);

      await choose(wrapper, 'Delete monitor');

      expect(wrapper.find('[role="dialog"]').text()).toContain('Docs');
      expect(deleteMonitor).not.toHaveBeenCalled();
    });

    it('does not delete when cancelled', async () => {
      const { client, deleteMonitor } = trackedClient();
      const wrapper = await mountPageAt('/monitors', client);
      await choose(wrapper, 'Delete monitor');

      await wrapper.find('button[data-action="cancel"]').trigger('click');

      expect(deleteMonitor).not.toHaveBeenCalled();
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    });

    it('deletes after confirmation, tells the user and refreshes the list and the counts', async () => {
      const { client, listMonitors, deleteMonitor } = trackedClient();
      const { toasts, navCounts, refreshNavCounts } = environment(client);
      const wrapper = await mountPageAt('/monitors', client, { toasts, navCounts });
      await choose(wrapper, 'Delete monitor');
      const listCallsBefore = listMonitors.mock.calls.length;

      await wrapper.find('button[data-action="confirm"]').trigger('click');
      await flushPromises();

      expect(deleteMonitor).toHaveBeenCalledWith('mon_1');
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(toasts.toasts.value.map((toast) => toast.text)).toEqual(['Deleted Docs']);
      expect(listMonitors).toHaveBeenCalledTimes(listCallsBefore + 1);
      expect(refreshNavCounts).toHaveBeenCalledOnce();
    });
  });

  describe('acting on the last row of the last page', () => {
    function lastRowOfPageTwo() {
      const listMonitors = vi
        .fn()
        .mockResolvedValueOnce(pageOf([MONITOR_WITH_SUMMARY], null, 21))
        .mockResolvedValueOnce(pageOf([], null, 20))
        .mockResolvedValue(pageOf([MONITOR_WITH_SUMMARY], 'after_1', 20));
      return { listMonitors, client: stubClient({ listMonitors }) };
    }

    it('steps back a page when deleting it leaves the page empty', async () => {
      const { listMonitors, client } = lastRowOfPageTwo();
      const wrapper = await mountPageAt('/monitors?page=2&cursor=after_1', client);
      await choose(wrapper, 'Delete monitor');

      await wrapper.find('button[data-action="confirm"]').trigger('click');
      await flushPromises();

      expect(listMonitors).toHaveBeenLastCalledWith({ health: null, q: null, cursor: null, limit: 20 });
      expect(query(wrapper)).toEqual({});
      expect(wrapper.text()).toContain('Showing 1-1 of 20');
    });

    it('steps back when pausing removes the monitor from the filtered page', async () => {
      const { listMonitors, client } = lastRowOfPageTwo();
      const wrapper = await mountPageAt('/monitors?health=up&page=2&cursor=after_1', client);

      await choose(wrapper, 'Pause monitoring');

      expect(listMonitors).toHaveBeenLastCalledWith({ health: 'up', q: null, cursor: null, limit: 20 });
    });

    it('stays on the first page when it is empty after the action', async () => {
      const listMonitors = vi.fn().mockResolvedValueOnce(pageOf([MONITOR_WITH_SUMMARY])).mockResolvedValue(pageOf([]));
      const wrapper = await mountPageAt('/monitors', stubClient({ listMonitors }));
      await choose(wrapper, 'Delete monitor');

      await wrapper.find('button[data-action="confirm"]').trigger('click');
      await flushPromises();

      expect(listMonitors).toHaveBeenCalledTimes(2);
      expect(wrapper.text()).toContain('No monitors yet');
    });

    it('does not step back because the list failed to load', async () => {
      const listMonitors = vi.fn().mockResolvedValueOnce(pageOf([MONITOR_WITH_SUMMARY], null, 21)).mockRejectedValue(new Error('network down'));
      const wrapper = await mountPageAt('/monitors?page=2&cursor=after_1', stubClient({ listMonitors }));
      await choose(wrapper, 'Delete monitor');

      await wrapper.find('button[data-action="confirm"]').trigger('click');
      await flushPromises();

      expect(listMonitors).toHaveBeenCalledTimes(2);
      expect(query(wrapper)).toEqual({ page: '2', cursor: 'after_1' });
    });
  });

  it('reloads the list on the Refresh button', async () => {
    const { client, listMonitors } = trackedClient();
    const wrapper = await mountPageAt('/monitors', client);
    const callsBefore = listMonitors.mock.calls.length;

    await wrapper.find('button[data-action="refresh"]').trigger('click');
    await flushPromises();

    expect(listMonitors).toHaveBeenCalledTimes(callsBefore + 1);
  });
});
