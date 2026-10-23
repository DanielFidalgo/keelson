import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { MONITOR, mountPageAt, OPEN_DRIFT_INCIDENT, stubClient } from '../test-support.js';

describe('IncidentsPage', () => {
  it('lists open incidents with the name of their monitor', async () => {
    const client = stubClient({ listOpenIncidents: vi.fn(() => Promise.resolve([OPEN_DRIFT_INCIDENT])) });

    const wrapper = await mountPageAt('/incidents', client);

    expect(wrapper.text()).toContain(MONITOR.name);
    expect(wrapper.text()).toContain('drift');
  });

  it('acknowledges an incident when the button is pressed', async () => {
    const acknowledged = { ...OPEN_DRIFT_INCIDENT, acknowledgedAt: '2026-10-22T12:01:00.000Z' };
    const acknowledgeIncident = vi.fn(() => Promise.resolve(acknowledged));
    const client = stubClient({
      listOpenIncidents: vi.fn().mockResolvedValueOnce([OPEN_DRIFT_INCIDENT]).mockResolvedValue([acknowledged]),
      acknowledgeIncident,
    });
    const wrapper = await mountPageAt('/incidents', client);

    await wrapper.find('button[data-action="acknowledge"]').trigger('click');
    await flushPromises();

    expect(acknowledgeIncident).toHaveBeenCalledWith(OPEN_DRIFT_INCIDENT.id);
    expect(wrapper.find('button[data-action="acknowledge"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Acknowledged');
  });

  it('says so when nothing is open', async () => {
    const wrapper = await mountPageAt('/incidents', stubClient());

    expect(wrapper.text()).toContain('No open incidents');
  });
});
