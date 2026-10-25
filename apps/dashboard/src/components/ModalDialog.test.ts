import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ModalDialog from './ModalDialog.vue';

let opener: HTMLButtonElement | undefined;

afterEach(() => {
  opener?.remove();
  document.body.innerHTML = '';
});

function open() {
  opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  return mount(ModalDialog, {
    props: { title: 'Add monitor' },
    slots: { default: '<input id="first" /><input id="second" />', footer: '<button id="last">Save</button>' },
    attachTo: document.body,
  });
}

describe('ModalDialog', () => {
  it('keeps focus inside when the backdrop is pressed, since the browser would otherwise move it to the page behind', () => {
    const wrapper = open();
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

    wrapper.find('.modal-backdrop').element.dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
    wrapper.unmount();
  });

  it('ignores Escape and the backdrop when it is not dismissible, so only its own buttons close it', async () => {
    const wrapper = mount(ModalDialog, { props: { title: 'Keep', dismissible: false }, slots: { default: '<input />' }, attachTo: document.body });

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    await wrapper.find('.modal-backdrop').trigger('click');

    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  it('is a modal dialog named by its title', () => {
    const wrapper = open();

    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(wrapper.find(`#${dialog.attributes('aria-labelledby') ?? ''}`).text()).toBe('Add monitor');
    wrapper.unmount();
  });

  it('moves focus inside when it opens and returns it to the opener when it closes', () => {
    const wrapper = open();

    expect(document.activeElement?.id).toBe('first');

    wrapper.unmount();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape and when the backdrop is clicked, but not when the dialog itself is clicked', async () => {
    const wrapper = open();

    await wrapper.find('[role="dialog"]').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    await wrapper.find('.modal-backdrop').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(2);
    wrapper.unmount();
  });

  it('stays focusable itself, so Escape and Tab still reach it after a click on its plain text', async () => {
    const wrapper = open();
    const dialog = wrapper.find('[role="dialog"]');

    (dialog.element as HTMLElement).focus();

    expect(document.activeElement).toBe(dialog.element);
    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.id).toBe('last');
    wrapper.unmount();
  });

  it('keeps Tab inside the dialog, wrapping from the last control to the first and back', async () => {
    const wrapper = open();
    const dialog = wrapper.find('[role="dialog"]');
    (document.querySelector('#last') as HTMLElement).focus();

    await dialog.trigger('keydown', { key: 'Tab' });
    expect(document.activeElement?.id).toBe('first');

    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.id).toBe('last');
    wrapper.unmount();
  });
});
