import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient, type Problem } from '../api/client.js';
import { apiClientKey } from '../injection.js';
import { MONITOR, stubClient } from '../test-support.js';
import AddMonitorDialog from './AddMonitorDialog.vue';

afterEach(() => {
  document.body.innerHTML = '';
});

function dialog(client: ApiClient = stubClient()) {
  return mount(AddMonitorDialog, { attachTo: document.body, global: { provide: { [apiClientKey as symbol]: client } } });
}

async function fillIn(wrapper: ReturnType<typeof dialog>, fields: { name?: string; url?: string; token?: string; minutes?: string } = {}) {
  await wrapper.find('input[name="name"]').setValue(fields.name ?? 'Docs');
  await wrapper.find('input[name="url"]').setValue(fields.url ?? 'https://mcp.example.com/mcp');
  if (fields.token !== undefined) await wrapper.find('input[name="authSecret"]').setValue(fields.token);
  if (fields.minutes !== undefined) await wrapper.find('select[name="interval"]').setValue(fields.minutes);
}

async function submit(wrapper: ReturnType<typeof dialog>) {
  await wrapper.find('form').trigger('submit');
  await flushPromises();
}

function rejectedWith(problem: Partial<Problem>): ApiError {
  return new ApiError({ type: 'about:blank', title: '', status: 400, detail: 'Invalid request', ...problem });
}

describe('AddMonitorDialog', () => {
  it('offers 5, 15, 30 and 60 minutes, starting on 15, and explains that 5 minutes is for demo mode', () => {
    const wrapper = dialog();

    const select = wrapper.find<HTMLSelectElement>('select[name="interval"]');
    expect(select.findAll('option').map((option) => option.text())).toEqual(['5 minutes', '15 minutes', '30 minutes', '60 minutes']);
    expect(select.element.value).toBe('15');
    expect(wrapper.text()).toContain('5 minutes only takes effect in demo mode');
  });

  it('sends the default interval in seconds and leaves the token out when it is blank', async () => {
    const createMonitor = vi.fn(() => Promise.resolve(MONITOR));
    const wrapper = dialog(stubClient({ createMonitor }));

    await fillIn(wrapper);
    await submit(wrapper);

    expect(createMonitor).toHaveBeenCalledWith({ name: 'Docs', url: 'https://mcp.example.com/mcp', intervalSeconds: 900 });
  });

  it('sends a chosen interval in seconds with the bearer token', async () => {
    const createMonitor = vi.fn(() => Promise.resolve(MONITOR));
    const wrapper = dialog(stubClient({ createMonitor }));

    await fillIn(wrapper, { minutes: '60', token: 's3cret' });
    await submit(wrapper);

    expect(createMonitor).toHaveBeenCalledWith({ name: 'Docs', url: 'https://mcp.example.com/mcp', intervalSeconds: 3600, authSecret: 's3cret' });
  });

  it('keeps the token in a password field', () => {
    expect(dialog().find('input[name="authSecret"]').attributes('type')).toBe('password');
  });

  it('reports the created monitor on success', async () => {
    const wrapper = dialog();

    await fillIn(wrapper);
    await submit(wrapper);

    expect(wrapper.emitted('created')).toEqual([[MONITOR]]);
  });

  it('shows every problem the API lists for a 400 and stays open', async () => {
    const createMonitor = vi.fn(() => Promise.reject(rejectedWith({ errors: ['name must not be empty', 'url must be https'] })));
    const wrapper = dialog(stubClient({ createMonitor }));

    await fillIn(wrapper);
    await submit(wrapper);

    const problems = wrapper.findAll('[role="alert"] li').map((item) => item.text());
    expect(problems).toEqual(['name must not be empty', 'url must be https']);
    expect(wrapper.emitted('created')).toBeUndefined();
  });

  it('falls back to the problem detail when the API lists no problems', async () => {
    const createMonitor = vi.fn(() => Promise.reject(rejectedWith({ status: 403, detail: 'Monitor limit reached' })));
    const wrapper = dialog(stubClient({ createMonitor }));

    await fillIn(wrapper);
    await submit(wrapper);

    expect(wrapper.find('[role="alert"]').text()).toBe('Monitor limit reached');
  });

  it('clears the earlier problems when the next attempt succeeds', async () => {
    const createMonitor = vi.fn().mockRejectedValueOnce(rejectedWith({ errors: ['url must be https'] })).mockResolvedValue(MONITOR);
    const wrapper = dialog(stubClient({ createMonitor }));
    await fillIn(wrapper);
    await submit(wrapper);

    await submit(wrapper);

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('does not send a second request while the first is in flight', async () => {
    const createMonitor = vi.fn(() => new Promise<never>(() => undefined));
    const wrapper = dialog(stubClient({ createMonitor }));
    await fillIn(wrapper);

    await submit(wrapper);
    await submit(wrapper);

    expect(createMonitor).toHaveBeenCalledOnce();
  });

  it('asks to close on Escape and on Cancel', async () => {
    const wrapper = dialog();

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    await wrapper.find('button[data-action="cancel"]').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(2);
  });
});
