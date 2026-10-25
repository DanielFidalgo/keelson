import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { IncidentView } from '../api/client.js';
import { OPEN_DRIFT_INCIDENT } from '../test-support.js';
import IncidentState from './IncidentState.vue';

const ACKNOWLEDGED_AT = '2026-10-22T12:01:00.000Z';
const RESOLVED: IncidentView = { ...OPEN_DRIFT_INCIDENT, state: 'resolved', resolvedAt: '2026-10-22T12:10:00.000Z', resolution: 'recovered' };

const stateOf = (incident: IncidentView) => mount(IncidentState, { props: { incident } });

describe('IncidentState', () => {
  it('says Open for an incident nobody has acknowledged', () => {
    expect(stateOf(OPEN_DRIFT_INCIDENT).text()).toBe('Open');
  });

  it('says Acknowledged, and since when, once somebody has', () => {
    const wrapper = stateOf({ ...OPEN_DRIFT_INCIDENT, acknowledgedAt: ACKNOWLEDGED_AT });

    expect(wrapper.text()).toMatch(/^Acknowledged/);
    expect(wrapper.find('time').exists()).toBe(true);
  });

  it.each([
    ['recovered', 'Recovered'],
    ['approved', 'Approved'],
    ['reverted', 'Reverted'],
    [null, 'Resolved'],
  ] as const)('words a %s resolution as %s', (resolution, label) => {
    expect(stateOf({ ...RESOLVED, resolution }).find('.status-pill').text()).toBe(label);
  });
});
