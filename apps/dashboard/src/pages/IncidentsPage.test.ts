import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { IncidentCounts, IncidentView } from '../api/client.js';
import { createNavCounts } from '../composables/useNavCounts.js';
import { createToasts } from '../composables/useToasts.js';
import { MONITOR, mountPageAt, OPEN_DRIFT_INCIDENT, pageOf, stubClient } from '../test-support.js';

type Mounted = Awaited<ReturnType<typeof mountPageAt>>;

const COUNTS: IncidentCounts = { open: 2, acknowledged: 3, resolved: 41, drift: 4, down: 1 };
const ACKNOWLEDGED_INCIDENT: IncidentView = { ...OPEN_DRIFT_INCIDENT, acknowledgedAt: '2026-10-22T12:01:00.000Z' };
const RESOLVED_INCIDENT: IncidentView = {
  ...OPEN_DRIFT_INCIDENT,
  id: 'inc_2',
  kind: 'down',
  severity: null,
  state: 'resolved',
  openedAt: '2026-10-22T12:00:00.000Z',
  resolvedAt: '2026-10-22T12:12:30.000Z',
  resolution: 'recovered',
};

const FIRST_PAGE = { cursor: null, limit: 20 };

const query = (wrapper: Mounted) => wrapper.vm.$router.currentRoute.value.query;
const segment = (wrapper: Mounted, label: string) => wrapper.findAll('.segmented button').find((button) => button.text().startsWith(label));
const acknowledgeButtons = (wrapper: Mounted) => wrapper.findAll('button[data-action="acknowledge"]');

function environment(client = stubClient()) {
  const toasts = createToasts();
  const refreshNavCounts = vi.fn(() => Promise.resolve());
  const navCounts = { ...createNavCounts(client), refresh: refreshNavCounts };
  return { toasts, navCounts, refreshNavCounts };
}

describe('IncidentsPage', () => {
  describe('state tabs', () => {
    it('opens on Open incidents that nobody has acknowledged', async () => {
      const listIncidents = vi.fn(() => Promise.resolve(pageOf([OPEN_DRIFT_INCIDENT])));

      const wrapper = await mountPageAt('/incidents', stubClient({ listIncidents }));

      expect(listIncidents).toHaveBeenCalledWith({ state: 'open', acknowledged: false, kind: null, ...FIRST_PAGE });
      expect(wrapper.text()).toContain(MONITOR.name);
      expect(wrapper.find('.status-pill').text()).toBe('Drift · critical');
    });

    it('asks for open and acknowledged incidents on the Acknowledged tab', async () => {
      const listIncidents = vi.fn(() => Promise.resolve(pageOf([ACKNOWLEDGED_INCIDENT])));

      await mountPageAt('/incidents?state=acknowledged', stubClient({ listIncidents }));

      expect(listIncidents).toHaveBeenCalledWith({ state: 'open', acknowledged: true, kind: null, ...FIRST_PAGE });
    });

    it('asks for resolved incidents, acknowledged or not, on the Resolved tab', async () => {
      const listIncidents = vi.fn(() => Promise.resolve(pageOf([RESOLVED_INCIDENT])));

      await mountPageAt('/incidents?state=resolved', stubClient({ listIncidents }));

      expect(listIncidents).toHaveBeenCalledWith({ state: 'resolved', acknowledged: null, kind: null, ...FIRST_PAGE });
    });

    it('reads a state it does not know as Open', async () => {
      const listIncidents = vi.fn(() => Promise.resolve(pageOf([])));

      await mountPageAt('/incidents?state=bogus', stubClient({ listIncidents }));

      expect(listIncidents).toHaveBeenCalledWith({ state: 'open', acknowledged: false, kind: null, ...FIRST_PAGE });
    });

    it('moves to a tab through the URL, and keeps Open out of it', async () => {
      const listIncidents = vi.fn(() => Promise.resolve(pageOf([])));
      const wrapper = await mountPageAt('/incidents', stubClient({ listIncidents }));

      await segment(wrapper, 'Resolved')?.trigger('click');
      await flushPromises();
      expect(query(wrapper)).toEqual({ state: 'resolved' });
      expect(listIncidents).toHaveBeenLastCalledWith({ state: 'resolved', acknowledged: null, kind: null, ...FIRST_PAGE });

      await segment(wrapper, 'Open')?.trigger('click');
      await flushPromises();
      expect(query(wrapper)).toEqual({});
    });

    it('shows how many incidents each tab holds', async () => {
      const wrapper = await mountPageAt('/incidents', stubClient({ getIncidentCounts: vi.fn(() => Promise.resolve(COUNTS)) }));

      expect(['Open', 'Acknowledged', 'Resolved'].map((label) => segment(wrapper, label)?.text())).toEqual(['Open2', 'Acknowledged3', 'Resolved41']);
    });

    it('still lists incidents when the counts cannot be read', async () => {
      const client = stubClient({
        listIncidents: vi.fn(() => Promise.resolve(pageOf([OPEN_DRIFT_INCIDENT]))),
        getIncidentCounts: vi.fn(() => Promise.reject(new Error('offline'))),
      });

      const wrapper = await mountPageAt('/incidents', client);

      expect(wrapper.text()).toContain(MONITOR.name);
      expect(segment(wrapper, 'Open')?.text()).toBe('Open');
    });
  });

  describe('kind filter', () => {
    it('narrows the list to one kind and back to all', async () => {
      const listIncidents = vi.fn(() => Promise.resolve(pageOf([])));
      const wrapper = await mountPageAt('/incidents', stubClient({ listIncidents }));

      await segment(wrapper, 'Down')?.trigger('click');
      await flushPromises();
      expect(listIncidents).toHaveBeenLastCalledWith({ state: 'open', acknowledged: false, kind: 'down', ...FIRST_PAGE });
      expect(query(wrapper)).toEqual({ kind: 'down' });

      await segment(wrapper, 'All kinds')?.trigger('click');
      await flushPromises();
      expect(listIncidents).toHaveBeenLastCalledWith({ state: 'open', acknowledged: false, kind: null, ...FIRST_PAGE });
    });

    it('reads a kind it does not know as all kinds', async () => {
      const listIncidents = vi.fn(() => Promise.resolve(pageOf([])));

      await mountPageAt('/incidents?kind=bogus', stubClient({ listIncidents }));

      expect(listIncidents).toHaveBeenCalledWith({ state: 'open', acknowledged: false, kind: null, ...FIRST_PAGE });
    });
  });

  describe('rows', () => {
    it('links the monitor and shows the kind with its severity', async () => {
      const wrapper = await mountPageAt('/incidents', stubClient({ listIncidents: vi.fn(() => Promise.resolve(pageOf([OPEN_DRIFT_INCIDENT]))) }));

      expect(wrapper.find('a[href="/monitors/mon_1"]').text()).toBe(MONITOR.name);
      expect(wrapper.find('.status-pill').text()).toBe('Drift · critical');
    });

    it('shows a resolved incident with how it ended and how long it lasted', async () => {
      const wrapper = await mountPageAt('/incidents?state=resolved', stubClient({ listIncidents: vi.fn(() => Promise.resolve(pageOf([RESOLVED_INCIDENT]))) }));

      const pills = wrapper.findAll('.status-pill').map((pill) => pill.text());
      expect(pills).toEqual(['Down', 'Recovered']);
      expect(wrapper.find('[data-duration]').text()).toBe('12 min');
      expect(acknowledgeButtons(wrapper)).toHaveLength(0);
    });

    it.each([
      ['approved', 'Approved'],
      ['reverted', 'Reverted'],
    ] as const)('words a %s resolution as %s', async (resolution, label) => {
      const resolved = { ...RESOLVED_INCIDENT, kind: 'drift', severity: 'warning', resolution } as const;

      const wrapper = await mountPageAt('/incidents?state=resolved', stubClient({ listIncidents: vi.fn(() => Promise.resolve(pageOf([resolved]))) }));

      expect(wrapper.findAll('.status-pill').map((pill) => pill.text())).toEqual(['Drift · warning', label]);
    });

    it.each([
      [45_000, '< 1 min'],
      [4 * 60_000, '4 min'],
      [60 * 60_000, '1 h'],
      [90 * 60_000, '1 h 30 min'],
      [26 * 60 * 60_000, '1 d 2 h'],
    ])('words a duration of %d ms as %s', async (milliseconds, expected) => {
      const openedAt = Date.parse(RESOLVED_INCIDENT.openedAt);
      const resolved = { ...RESOLVED_INCIDENT, resolvedAt: new Date(openedAt + milliseconds).toISOString() };

      const wrapper = await mountPageAt('/incidents?state=resolved', stubClient({ listIncidents: vi.fn(() => Promise.resolve(pageOf([resolved]))) }));

      expect(wrapper.find('[data-duration]').text()).toBe(expected);
    });

    it('offers Acknowledge only on open incidents that nobody has acknowledged', async () => {
      const client = stubClient({ listIncidents: vi.fn(() => Promise.resolve(pageOf([OPEN_DRIFT_INCIDENT, { ...ACKNOWLEDGED_INCIDENT, id: 'inc_3' }]))) });

      const wrapper = await mountPageAt('/incidents', client);

      const states = wrapper.findAll('[data-cell="state"]').map((cell) => cell.text());
      expect(acknowledgeButtons(wrapper)).toHaveLength(1);
      expect(states[0]).toBe('Open');
      expect(states[1]).toMatch(/^Acknowledged/);
    });

    it('renders hostile text from a monitor name literally', async () => {
      const hostile = { ...OPEN_DRIFT_INCIDENT, monitorName: '<img src=x onerror=alert(1)>' };

      const wrapper = await mountPageAt('/incidents', stubClient({ listIncidents: vi.fn(() => Promise.resolve(pageOf([hostile]))) }));

      expect(wrapper.find('img').exists()).toBe(false);
      expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
    });
  });

  describe('acknowledging', () => {
    it('acknowledges the incident, tells the user, and reloads the list, the counts and the sidebar', async () => {
      const acknowledgeIncident = vi.fn(() => Promise.resolve(ACKNOWLEDGED_INCIDENT));
      const getIncidentCounts = vi.fn(() => Promise.resolve(COUNTS));
      const listIncidents = vi.fn().mockResolvedValueOnce(pageOf([OPEN_DRIFT_INCIDENT])).mockResolvedValue(pageOf([]));
      const client = stubClient({ listIncidents, acknowledgeIncident, getIncidentCounts });
      const { toasts, navCounts, refreshNavCounts } = environment(client);
      const wrapper = await mountPageAt('/incidents', client, { toasts, navCounts });
      const countReadsBefore = getIncidentCounts.mock.calls.length;

      await acknowledgeButtons(wrapper)[0]?.trigger('click');
      await flushPromises();

      expect(acknowledgeIncident).toHaveBeenCalledWith(OPEN_DRIFT_INCIDENT.id);
      expect(listIncidents).toHaveBeenCalledTimes(2);
      expect(getIncidentCounts.mock.calls.length).toBe(countReadsBefore + 1);
      expect(refreshNavCounts).toHaveBeenCalledOnce();
      expect(acknowledgeButtons(wrapper)).toHaveLength(0);
      expect(toasts.toasts.value.map(({ text }) => text)).toEqual(['Incident acknowledged']);
    });

    it('shows the problem as a toast when acknowledging fails, and leaves the list alone', async () => {
      const listIncidents = vi.fn(() => Promise.resolve(pageOf([OPEN_DRIFT_INCIDENT])));
      const client = stubClient({ listIncidents, acknowledgeIncident: vi.fn(() => Promise.reject(new Error('offline'))) });
      const { toasts, navCounts, refreshNavCounts } = environment(client);
      const wrapper = await mountPageAt('/incidents', client, { toasts, navCounts });

      await acknowledgeButtons(wrapper)[0]?.trigger('click');
      await flushPromises();

      expect(toasts.toasts.value.map(({ kind }) => kind)).toEqual(['failure']);
      expect(listIncidents).toHaveBeenCalledOnce();
      expect(refreshNavCounts).not.toHaveBeenCalled();
    });

    it('steps back a page when acknowledging the only row of the last page empties it', async () => {
      const listIncidents = vi
        .fn()
        .mockResolvedValueOnce(pageOf([OPEN_DRIFT_INCIDENT], null, 21))
        .mockResolvedValueOnce(pageOf([], null, 20))
        .mockResolvedValue(pageOf([OPEN_DRIFT_INCIDENT], 'after_1', 20));
      const wrapper = await mountPageAt('/incidents?page=2&cursor=after_1', stubClient({ listIncidents }));

      await acknowledgeButtons(wrapper)[0]?.trigger('click');
      await flushPromises();

      expect(listIncidents).toHaveBeenLastCalledWith({ state: 'open', acknowledged: false, kind: null, ...FIRST_PAGE });
      expect(query(wrapper)).toEqual({});
    });
  });

  describe('empty and failing lists', () => {
    it.each([
      ['/incidents', 'No open incidents'],
      ['/incidents?state=acknowledged', 'No acknowledged incidents'],
      ['/incidents?state=resolved', 'No resolved incidents'],
    ])('says so on %s when there is nothing to show', async (path, title) => {
      const wrapper = await mountPageAt(path, stubClient());

      expect(wrapper.text()).toContain(title);
    });

    it('suggests all kinds when a kind filter finds nothing', async () => {
      const wrapper = await mountPageAt('/incidents?kind=down', stubClient());

      expect(wrapper.text()).toContain('Try all kinds.');
    });

    it('offers to retry when the list cannot be loaded', async () => {
      const listIncidents = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(pageOf([OPEN_DRIFT_INCIDENT]));
      const wrapper = await mountPageAt('/incidents', stubClient({ listIncidents }));
      expect(wrapper.find('[role="alert"]').text()).toContain('offline');

      await wrapper.find('button[data-action="retry"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain(MONITOR.name);
    });

    it('reloads on the Refresh button', async () => {
      const listIncidents = vi.fn(() => Promise.resolve(pageOf([])));
      const wrapper = await mountPageAt('/incidents', stubClient({ listIncidents }));

      await wrapper.find('button[data-action="refresh"]').trigger('click');
      await flushPromises();

      expect(listIncidents).toHaveBeenCalledTimes(2);
    });
  });
});
