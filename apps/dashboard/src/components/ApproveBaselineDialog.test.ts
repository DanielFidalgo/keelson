import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient, type Change } from '../api/client.js';
import { apiClientKey } from '../injection.js';
import { MONITOR, stubClient } from '../test-support.js';
import ApproveBaselineDialog from './ApproveBaselineDialog.vue';

const TO_HASH = 'c'.repeat(64);

const warning: Change = { kind: 'tool_added', severity: 'warning', name: 'search' };
const critical: Change = { kind: 'input_schema_changed', severity: 'critical', name: 'fetch', classification: 'breaking' };

async function dialog(client: ApiClient) {
  const wrapper = mount(ApproveBaselineDialog, {
    props: { monitorId: MONITOR.id, monitorName: MONITOR.name },
    attachTo: document.body,
    global: { provide: { [apiClientKey as symbol]: client } },
  });
  await flushPromises();
  return wrapper;
}

const driftOf = (changes: Change[]) => vi.fn(() => Promise.resolve({ drift: { fromHash: MONITOR.baselineHash ?? '', toHash: TO_HASH, changes } }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ApproveBaselineDialog', () => {
  it('reads the current drift of that monitor before offering anything', async () => {
    const getDrift = driftOf([warning]);

    const wrapper = await dialog(stubClient({ getDrift }));

    expect(getDrift).toHaveBeenCalledWith(MONITOR.id);
    expect(wrapper.text()).toContain(MONITOR.name);
  });

  it('shows the number of changes, the highest severity and the hash it will approve', async () => {
    const wrapper = await dialog(stubClient({ getDrift: driftOf([warning, critical]) }));

    expect(wrapper.find('[data-field="changes"]').text()).toBe('2 changes');
    expect(wrapper.find('[data-field="severity"]').text()).toBe('Critical');
    expect(wrapper.find('[data-field="hash"]').text()).toBe(TO_HASH);
  });

  it('calls a lone change a change and a warning-only drift a warning', async () => {
    const wrapper = await dialog(stubClient({ getDrift: driftOf([warning]) }));

    expect(wrapper.find('[data-field="changes"]').text()).toBe('1 change');
    expect(wrapper.find('[data-field="severity"]').text()).toBe('Warning');
  });

  it('approves exactly the hash it showed and reports it', async () => {
    const approveBaseline = vi.fn(() => Promise.resolve(MONITOR));
    const wrapper = await dialog(stubClient({ getDrift: driftOf([warning]), approveBaseline }));

    await wrapper.find('button[data-action="approve"]').trigger('click');
    await flushPromises();

    expect(approveBaseline).toHaveBeenCalledWith(MONITOR.id, TO_HASH);
    expect(wrapper.emitted('approved')).toHaveLength(1);
  });

  it('cannot approve before the drift has loaded', () => {
    const wrapper = mount(ApproveBaselineDialog, {
      props: { monitorId: MONITOR.id, monitorName: MONITOR.name },
      attachTo: document.body,
      global: { provide: { [apiClientKey as symbol]: stubClient({ getDrift: () => new Promise<never>(() => undefined) }) } },
    });

    expect(wrapper.find('button[data-action="approve"]').attributes('disabled')).toBeDefined();
  });

  it('offers nothing to approve when the monitor no longer drifts', async () => {
    const approveBaseline = vi.fn(() => Promise.resolve(MONITOR));
    const wrapper = await dialog(stubClient({ getDrift: () => Promise.resolve({ drift: null }), approveBaseline }));

    expect(wrapper.text()).toContain('No drift to approve');
    expect(wrapper.find('button[data-action="approve"]').attributes('disabled')).toBeDefined();
    expect(approveBaseline).not.toHaveBeenCalled();
  });

  it('shows why the drift could not be read and offers no approval', async () => {
    const getDrift = () => Promise.reject(new Error('network down'));

    const wrapper = await dialog(stubClient({ getDrift }));

    expect(wrapper.find('[role="alert"]').text()).toContain('network down');
    expect(wrapper.find('button[data-action="approve"]').attributes('disabled')).toBeDefined();
  });

  it('shows the API problem when approving fails and does not report an approval', async () => {
    const problem = new ApiError({ type: 'about:blank', title: '', status: 409, detail: 'The snapshot is not from this monitor' });
    const wrapper = await dialog(stubClient({ getDrift: driftOf([warning]), approveBaseline: () => Promise.reject(problem) }));

    await wrapper.find('button[data-action="approve"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain('The snapshot is not from this monitor');
    expect(wrapper.emitted('approved')).toBeUndefined();
  });

  it('renders a hostile monitor name as text', async () => {
    const wrapper = mount(ApproveBaselineDialog, {
      props: { monitorId: MONITOR.id, monitorName: '<img src=x onerror=alert(1)>' },
      attachTo: document.body,
      global: { provide: { [apiClientKey as symbol]: stubClient() } },
    });
    await flushPromises();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
  });

  it('asks to close on Cancel', async () => {
    const wrapper = await dialog(stubClient());

    await wrapper.find('button[data-action="cancel"]').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
