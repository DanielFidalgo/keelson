import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import PageHeader from './PageHeader.vue';

describe('PageHeader', () => {
  it('shows the title as the page heading, with the controls it is given beside it', () => {
    const wrapper = mount(PageHeader, { props: { title: 'Monitors' }, slots: { default: '<button>Add monitor</button>' } });

    expect(wrapper.find('h1').text()).toBe('Monitors');
    expect(wrapper.find('button').text()).toBe('Add monitor');
  });
});
