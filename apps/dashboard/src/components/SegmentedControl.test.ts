import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SegmentedControl from './SegmentedControl.vue';

const OPTIONS = [
  { value: null, label: 'All', count: 19 },
  { value: 'up', label: 'Up', count: 17 },
  { value: 'drift', label: 'Drift' },
];

const control = (modelValue: string | null) => mount(SegmentedControl, { props: { label: 'Health', modelValue, options: OPTIONS } });

describe('SegmentedControl', () => {
  it('shows each option with its count when it has one', () => {
    const wrapper = control(null);

    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['All19', 'Up17', 'Drift']);
    expect(wrapper.find('[role="group"]').attributes('aria-label')).toBe('Health');
  });

  it('marks the selected option, with null selecting the one without a value', () => {
    expect(control(null).findAll('button').map((button) => button.attributes('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(control('drift').findAll('button').map((button) => button.attributes('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });

  it('reports the value of the option pressed', async () => {
    const wrapper = control(null);

    await wrapper.findAll('button')[1]?.trigger('click');
    await wrapper.findAll('button')[0]?.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([['up'], [null]]);
  });
});
