import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DataList from './DataList.vue';

// The shim that lets tsc import .vue files gives components no props, so the tests state the ones they pass.
interface Props {
  columns: string[];
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  emptyTitle: string;
  emptyHint: string;
}

const COLUMNS = ['Monitor', 'Status', ''];
const ROWS = '<tr><td>Docs</td><td>Up</td><td></td></tr>';

function list(props: Partial<Props> = {}) {
  return mount(DataList, {
    props: { columns: COLUMNS, loading: false, error: null, isEmpty: false, emptyTitle: 'No monitors yet', ...props },
    slots: { default: ROWS },
  });
}

describe('DataList', () => {
  it('shows the column headings and the rows it is given', () => {
    const wrapper = list();

    expect(wrapper.findAll('th').map((cell) => cell.text())).toEqual(COLUMNS);
    expect(wrapper.find('tbody').text()).toContain('Docs');
  });

  it('shows a skeleton as wide as the table while the first load is under way', () => {
    const wrapper = list({ loading: true, isEmpty: true });

    expect(wrapper.attributes('aria-busy')).toBe('true');
    expect(wrapper.findAll('tbody tr.skeleton-row').length).toBeGreaterThan(0);
    expect(wrapper.findAll('tbody tr.skeleton-row')[0]?.findAll('td')).toHaveLength(COLUMNS.length);
    expect(wrapper.text()).not.toContain('No monitors yet');
  });

  it('keeps the rows on screen while a refresh is under way instead of flashing a skeleton', () => {
    const wrapper = list({ loading: true });

    expect(wrapper.find('.skeleton-row').exists()).toBe(false);
    expect(wrapper.find('tbody').text()).toContain('Docs');
  });

  it('says so, with its hint, when there is nothing to show', () => {
    const wrapper = list({ isEmpty: true, emptyHint: 'Add one to start probing.' });

    expect(wrapper.text()).toContain('No monitors yet');
    expect(wrapper.text()).toContain('Add one to start probing.');
    expect(wrapper.find('table').exists()).toBe(false);
  });

  it('shows the failure with a Retry that asks the page to load again', async () => {
    const wrapper = list({ error: 'The API answered 502.', isEmpty: true });

    expect(wrapper.find('[role="alert"]').text()).toContain('The API answered 502.');
    await wrapper.find('button[data-action="retry"]').trigger('click');

    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('keeps the rows under a banner when a refresh fails after the list had loaded', async () => {
    const wrapper = list({ error: 'The API answered 502.' });

    expect(wrapper.find('[role="alert"]').text()).toContain('The API answered 502.');
    expect(wrapper.find('tbody').text()).toContain('Docs');
    expect(wrapper.text()).not.toContain('Could not load this list');
    await wrapper.find('button[data-action="retry"]').trigger('click');

    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('renders the failure as text', () => {
    const wrapper = list({ error: '<img src=x onerror=alert(1)>' });

    expect(wrapper.find('img').exists()).toBe(false);
  });
});
