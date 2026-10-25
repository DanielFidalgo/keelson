import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ErrorBanner from './ErrorBanner.vue';

// The shim that lets tsc import .vue files gives components no props, so the tests state the ones they pass.
interface Props {
  message: string;
  showingPrevious: boolean;
}

const banner = (props: Partial<Props> = {}) => mount(ErrorBanner, { props: { message: 'Could not load the overview: offline', showingPrevious: false, ...props } });

describe('ErrorBanner', () => {
  it('announces the message and asks the page to try again', async () => {
    const wrapper = banner();

    expect(wrapper.find('[role="alert"]').text()).toContain('Could not load the overview: offline');
    await wrapper.find('button[data-action="retry"]').trigger('click');

    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('says the earlier data is still shown only when it is', () => {
    expect(banner().text()).not.toContain('Showing what was loaded before.');
    expect(banner({ showingPrevious: true }).text()).toContain('Showing what was loaded before.');
  });

  it('renders the message as text', () => {
    expect(banner({ message: '<img src=x onerror=alert(1)>' }).find('img').exists()).toBe(false);
  });
});
