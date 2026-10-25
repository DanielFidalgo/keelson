import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Monitor } from '../api/client.js';
import { MONITOR } from '../test-support.js';
import MonitorSettingsForm from './MonitorSettingsForm.vue';

function form(monitor: Monitor = MONITOR, busy = false) {
  return mount(MonitorSettingsForm, { props: { monitor, busy } });
}

const saveButton = (wrapper: ReturnType<typeof form>) => wrapper.find<HTMLButtonElement>('button[data-action="save"]');

describe('MonitorSettingsForm', () => {
  it('starts from the monitor, with nothing to save', () => {
    const wrapper = form();

    expect(wrapper.find<HTMLInputElement>('input[name="name"]').element.value).toBe('Docs');
    expect(wrapper.find<HTMLSelectElement>('select[name="interval"]').element.value).toBe('5');
    expect(saveButton(wrapper).element.disabled).toBe(true);
  });

  it('sends only the new name', async () => {
    const wrapper = form();

    await wrapper.find('input[name="name"]').setValue('  Documentation  ');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('save')).toEqual([[{ name: 'Documentation' }]]);
  });

  it('sends the chosen interval in seconds', async () => {
    const wrapper = form();

    await wrapper.find('select[name="interval"]').setValue('30');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('save')).toEqual([[{ intervalSeconds: 1800 }]]);
  });

  it('sends a replacement token, and no token when the field is left empty', async () => {
    const wrapper = form({ ...MONITOR, hasAuthSecret: true });
    await wrapper.find('input[name="name"]').setValue('Other');
    await wrapper.find('form').trigger('submit');

    await wrapper.find('input[name="name"]').setValue(MONITOR.name);
    await wrapper.find('input[name="authSecret"]').setValue('s3cret');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('save')).toEqual([[{ name: 'Other' }], [{ authSecret: 's3cret' }]]);
  });

  it('keeps the token in a password field', () => {
    expect(form().find('input[name="authSecret"]').attributes('type')).toBe('password');
  });

  it('sends authSecret null to clear a stored token, even if a replacement was typed', async () => {
    const wrapper = form({ ...MONITOR, hasAuthSecret: true });

    await wrapper.find('input[name="authSecret"]').setValue('typed then regretted');
    await wrapper.find('input[name="clearAuthSecret"]').setValue(true);
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('save')).toEqual([[{ authSecret: null }]]);
  });

  it('offers to clear a token only when one is stored', () => {
    expect(form().find('input[name="clearAuthSecret"]').exists()).toBe(false);
    expect(form({ ...MONITOR, hasAuthSecret: true }).find('input[name="clearAuthSecret"]').exists()).toBe(true);
  });

  it('does not send anything while there is nothing to save', async () => {
    const wrapper = form();

    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('asks to delete the monitor', async () => {
    const wrapper = form();

    await wrapper.find('button[data-action="delete"]').trigger('click');

    expect(wrapper.emitted('delete')).toHaveLength(1);
  });

  it('cannot save or delete while an action is running', async () => {
    const wrapper = form(MONITOR, true);
    await wrapper.find('input[name="name"]').setValue('Other');

    expect(saveButton(wrapper).element.disabled).toBe(true);
    expect(wrapper.find<HTMLButtonElement>('button[data-action="delete"]').element.disabled).toBe(true);
  });
});
