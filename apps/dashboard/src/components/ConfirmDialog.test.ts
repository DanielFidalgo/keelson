import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ConfirmDialog from './ConfirmDialog.vue';

// The shim that lets tsc import .vue files gives components no props, so the tests state the ones they pass.
interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
}

afterEach(() => {
  document.body.innerHTML = '';
});

function dialog(props: Partial<Props> = {}) {
  return mount(ConfirmDialog, {
    props: { title: 'Delete monitor', body: 'Delete Docs and its history?', confirmLabel: 'Delete', ...props },
    attachTo: document.body,
  });
}

describe('ConfirmDialog', () => {
  it('shows the title, the body and the confirm label', () => {
    const wrapper = dialog();

    expect(wrapper.text()).toContain('Delete monitor');
    expect(wrapper.text()).toContain('Delete Docs and its history?');
    expect(wrapper.find('button[data-action="confirm"]').text()).toBe('Delete');
  });

  it('confirms only when the confirm button is pressed', async () => {
    const wrapper = dialog();

    await wrapper.find('button[data-action="confirm"]').trigger('click');

    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('cancel')).toBeUndefined();
  });

  it('cancels on the Cancel button, on Escape and on the backdrop', async () => {
    const wrapper = dialog();

    await wrapper.find('button[data-action="cancel"]').trigger('click');
    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    await wrapper.find('.modal-backdrop').trigger('click');

    expect(wrapper.emitted('cancel')).toHaveLength(3);
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('styles a dangerous confirmation as such and starts on Cancel so Enter cannot delete', () => {
    const wrapper = dialog({ danger: true });

    expect(wrapper.find('button[data-action="confirm"]').classes()).toContain('btn-danger');
    expect(document.activeElement).toBe(wrapper.find('button[data-action="cancel"]').element);
  });

  it('starts on the confirm button when nothing is at risk', () => {
    const wrapper = dialog();

    expect(wrapper.find('button[data-action="confirm"]').classes()).not.toContain('btn-danger');
    expect(document.activeElement).toBe(wrapper.find('button[data-action="confirm"]').element);
  });

  it('shows a monitor name that looks like markup as text', () => {
    const wrapper = dialog({ body: 'Delete <img src=x onerror=alert(1)>?' });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
  });
});
