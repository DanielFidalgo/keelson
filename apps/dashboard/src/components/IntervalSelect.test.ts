import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import IntervalSelect from './IntervalSelect.vue';

function intervalSelect(modelValue: number) {
  return mount(IntervalSelect, { props: { modelValue } });
}

describe('IntervalSelect', () => {
  it('offers 5, 15, 30 and 60 minutes with the current interval selected', () => {
    const select = intervalSelect(1800).find<HTMLSelectElement>('select[name="interval"]');

    expect(select.findAll('option').map((option) => option.text())).toEqual(['5 minutes', '15 minutes', '30 minutes', '60 minutes']);
    expect(select.element.value).toBe('30');
  });

  it('explains that 5 minutes is for demo mode', () => {
    expect(intervalSelect(900).text()).toContain('5 minutes only takes effect in demo mode');
  });

  it('reports the chosen interval in seconds', async () => {
    const wrapper = intervalSelect(900);

    await wrapper.find('select').setValue('60');

    expect(wrapper.emitted('update:modelValue')).toEqual([[3600]]);
  });

  it('keeps an interval outside the options visible instead of silently selecting another', () => {
    const select = intervalSelect(7200).find<HTMLSelectElement>('select');

    expect(select.findAll('option').map((option) => option.text())).toEqual(['5 minutes', '15 minutes', '30 minutes', '60 minutes', '120 minutes']);
    expect(select.element.value).toBe('120');
  });
});
