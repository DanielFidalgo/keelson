import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ListPagination from './ListPagination.vue';

// The shim that lets tsc import .vue files gives components no props, so the tests state the ones they pass.
interface Props {
  rangeLabel: string;
  pageSize: number;
  pageSizes: number[];
  hasPrevious: boolean;
  hasNext: boolean;
}

function pagination(props: Partial<Props> = {}) {
  return mount(ListPagination, {
    props: { rangeLabel: 'Showing 21-40 of 45', pageSize: 20, pageSizes: [10, 20, 50], hasPrevious: true, hasNext: true, ...props },
  });
}

describe('ListPagination', () => {
  it('shows the range it is given', () => {
    expect(pagination().text()).toContain('Showing 21-40 of 45');
  });

  it('asks for the next and the previous page', async () => {
    const wrapper = pagination();

    await wrapper.find('button[data-action="previous"]').trigger('click');
    await wrapper.find('button[data-action="next"]').trigger('click');

    expect(wrapper.emitted('previous')).toHaveLength(1);
    expect(wrapper.emitted('next')).toHaveLength(1);
  });

  it('disables a direction that has no page', () => {
    const wrapper = pagination({ hasPrevious: false, hasNext: false });

    expect(wrapper.find('button[data-action="previous"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('button[data-action="next"]').attributes('disabled')).toBeDefined();
  });

  it('offers every page size, with the current one selected, and reports a change as a number', async () => {
    const wrapper = pagination();
    const select = wrapper.find('select');

    expect(select.findAll('option').map((option) => option.text())).toEqual(['10 per page', '20 per page', '50 per page']);
    expect((select.element as HTMLSelectElement).value).toBe('20');

    await select.setValue('50');

    expect(wrapper.emitted('update:pageSize')).toEqual([[50]]);
  });
});
