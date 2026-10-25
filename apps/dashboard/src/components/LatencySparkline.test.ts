import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LatencySparkline from './LatencySparkline.vue';

const sparkline = (values: (number | null)[]) => mount(LatencySparkline, { props: { values } });

describe('LatencySparkline', () => {
  it('draws one bar per value', () => {
    expect(sparkline([120, 180, 90, 240]).findAll('rect')).toHaveLength(4);
  });

  it('marks a failed probe as a full-height failed bar', () => {
    const wrapper = sparkline([100, null, 200]);

    const failed = wrapper.findAll('rect.is-failed');
    expect(failed).toHaveLength(1);
    expect(wrapper.findAll('rect')[1]?.classes()).toContain('is-failed');
    expect(failed[0]?.attributes('height')).toBe(wrapper.find('svg').attributes('height'));
  });

  it('scales the bars to the slowest probe', () => {
    const heights = sparkline([50, 100]).findAll('rect').map((bar) => Number(bar.attributes('height')));

    expect(heights[1]).toBeGreaterThan(heights[0] ?? 0);
  });

  it('keeps a bar visible for a latency of zero', () => {
    const [bar] = sparkline([0, 0]).findAll('rect');

    expect(Number(bar?.attributes('height'))).toBeGreaterThan(0);
  });

  it('describes itself to assistive technology, with each latency as a tooltip', () => {
    const wrapper = sparkline([120, null]);

    expect(wrapper.find('svg').attributes('aria-label')).toBe('Latency of the last 2 probes');
    expect(wrapper.findAll('title').map((title) => title.text())).toEqual(['120 ms', 'failed']);
  });

  it('draws nothing without values', () => {
    expect(sparkline([]).find('svg').exists()).toBe(false);
  });
});
