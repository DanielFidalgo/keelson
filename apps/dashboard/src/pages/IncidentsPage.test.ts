import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createToasts } from '../composables/useToasts.js';
import { MONITOR, mountPageAt, OPEN_DRIFT_INCIDENT, pageOf, stubClient } from '../test-support.js';

describe('IncidentsPage', () => {
  it('lists open incidents with the name of their monitor', async () => {
    const listIncidents = vi.fn(() => Promise.resolve(pageOf([OPEN_DRIFT_INCIDENT])));

    const wrapper = await mountPageAt('/incidents', stubClient({ listIncidents }));

    expect(wrapper.text()).toContain(MONITOR.name);
    expect(wrapper.find('.status-pill').text()).toBe('Drift · critical');
    expect(listIncidents).toHaveBeenCalledWith({ state: 'open', limit: 20, cursor: null });
  });

  it('acknowledges an incident when the button is pressed, tells the user and reloads', async () => {
    const acknowledged = { ...OPEN_DRIFT_INCIDENT, acknowledgedAt: '2026-10-22T12:01:00.000Z' };
    const acknowledgeIncident = vi.fn(() => Promise.resolve(acknowledged));
    const client = stubClient({
      listIncidents: vi.fn().mockResolvedValueOnce(pageOf([OPEN_DRIFT_INCIDENT])).mockResolvedValue(pageOf([acknowledged])),
      acknowledgeIncident,
    });
    const toasts = createToasts();
    const wrapper = await mountPageAt('/incidents', client, { toasts });

    await wrapper.find('button[data-action="acknowledge"]').trigger('click');
    await flushPromises();

    expect(acknowledgeIncident).toHaveBeenCalledWith(OPEN_DRIFT_INCIDENT.id);
    expect(wrapper.find('button[data-action="acknowledge"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Acknowledged');
    expect(toasts.toasts.value.map(({ text }) => text)).toEqual(['Incident acknowledged']);
  });

  it('shows the problem as a toast when acknowledging fails', async () => {
    const client = stubClient({
      listIncidents: vi.fn(() => Promise.resolve(pageOf([OPEN_DRIFT_INCIDENT]))),
      acknowledgeIncident: vi.fn(() => Promise.reject(new Error('offline'))),
    });
    const toasts = createToasts();
    const wrapper = await mountPageAt('/incidents', client, { toasts });

    await wrapper.find('button[data-action="acknowledge"]').trigger('click');
    await flushPromises();

    expect(toasts.toasts.value.map(({ kind }) => kind)).toEqual(['failure']);
  });

  it('says so when nothing is open', async () => {
    const wrapper = await mountPageAt('/incidents', stubClient());

    expect(wrapper.text()).toContain('No open incidents');
  });
});
