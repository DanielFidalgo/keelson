import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import StatusPill from './StatusPill.vue';

// The shim that lets tsc import .vue files gives components no props, so the tests state the ones they pass.
interface Props {
  health: 'up' | 'drift' | 'down' | 'paused' | 'pending' | 'resolved';
  severity?: 'critical' | 'warning' | null;
  label?: string;
}

const pill = (props: Props) => mount(StatusPill, { props });

describe('StatusPill', () => {
  it.each([
    ['up', 'Up', 'success'],
    ['drift', 'Drift · critical', 'critical'],
    ['down', 'Down', 'danger'],
    ['paused', 'Paused', 'neutral'],
    ['pending', 'Pending', 'neutral'],
    ['resolved', 'Resolved', 'neutral'],
  ] as const)('shows %s as a dot and the text "%s"', (health, text, tone) => {
    const wrapper = pill(health === 'drift' ? { health, severity: 'critical' } : { health });

    expect(wrapper.find('.status-dot').exists()).toBe(true);
    expect(wrapper.text()).toBe(text);
    expect(wrapper.attributes('data-tone')).toBe(tone);
  });

  it('reads a drift with only warnings as yellow, and one without severity as critical', () => {
    expect(pill({ health: 'drift', severity: 'warning' }).attributes('data-tone')).toBe('warning');
    expect(pill({ health: 'drift', severity: null }).attributes('data-tone')).toBe('critical');
    expect(pill({ health: 'drift' }).text()).toBe('Drift');
  });

  it('shows a given label in place of the default text', () => {
    expect(pill({ health: 'down', label: 'Down · 3 failures' }).text()).toBe('Down · 3 failures');
  });

  it('renders the label as text', () => {
    const wrapper = pill({ health: 'up', label: '<b>Up</b>' });

    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.text()).toBe('<b>Up</b>');
  });
});
