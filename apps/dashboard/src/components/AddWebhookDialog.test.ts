import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient, type CreatedWebhookEndpoint, type Problem } from '../api/client.js';
import { createToasts, toastsKey } from '../composables/useToasts.js';
import { apiClientKey } from '../injection.js';
import { stubClient } from '../test-support.js';
import AddWebhookDialog from './AddWebhookDialog.vue';

const SECRET = 'whsec_0123456789abcdef';
const CREATED: CreatedWebhookEndpoint = {
  id: 'whe_1',
  url: 'https://hooks.example.com/keelson/token',
  format: 'standard',
  status: 'active',
  consecutiveFailures: 0,
  createdAt: '2026-10-22T12:00:00.000Z',
  signingSecret: SECRET,
};
const WARNING = 'You will not see this again';

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(navigator, 'clipboard');
});

function dialog(client: ApiClient = stubClient(), toasts = createToasts()) {
  return mount(AddWebhookDialog, { attachTo: document.body, global: { provide: { [apiClientKey as symbol]: client, [toastsKey as symbol]: toasts } } });
}

async function submit(wrapper: ReturnType<typeof dialog>, { url = CREATED.url, format }: { url?: string; format?: string } = {}) {
  await wrapper.find('input[name="url"]').setValue(url);
  if (format !== undefined) await wrapper.find('select[name="format"]').setValue(format);
  await wrapper.find('form').trigger('submit');
  await flushPromises();
}

function rejectedWith(problem: Partial<Problem>): ApiError {
  return new ApiError({ type: 'about:blank', title: '', status: 400, detail: 'Invalid request', ...problem });
}

describe('AddWebhookDialog', () => {
  it('offers the standard and Slack formats, starting on standard', () => {
    const wrapper = dialog();

    const select = wrapper.find<HTMLSelectElement>('select[name="format"]');
    expect(select.findAll('option').map((option) => option.text())).toEqual(['Standard (signed JSON)', 'Slack']);
    expect(select.element.value).toBe('standard');
  });

  it('creates the endpoint with the URL and format that were entered', async () => {
    const createWebhookEndpoint = vi.fn(() => Promise.resolve(CREATED));
    const wrapper = dialog(stubClient({ createWebhookEndpoint }));

    await submit(wrapper, { format: 'slack' });

    expect(createWebhookEndpoint).toHaveBeenCalledWith({ url: CREATED.url, format: 'slack' });
  });

  it('shows the signing secret in a box with a warning that it will not be shown again', async () => {
    const wrapper = dialog(stubClient({ createWebhookEndpoint: vi.fn(() => Promise.resolve(CREATED)) }));

    await submit(wrapper);

    expect(wrapper.find('[data-secret]').text()).toBe(SECRET);
    expect(wrapper.text()).toContain(WARNING);
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('tells the page about the new endpoint without handing it the secret', async () => {
    const wrapper = dialog(stubClient({ createWebhookEndpoint: vi.fn(() => Promise.resolve(CREATED)) }));

    await submit(wrapper);

    const [[endpoint]] = wrapper.emitted('created') as [[Record<string, unknown>]];
    expect(endpoint).toMatchObject({ id: 'whe_1', url: CREATED.url });
    expect(JSON.stringify(endpoint)).not.toContain(SECRET);
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('says a Slack endpoint is not signed instead of showing a secret box', async () => {
    const slack = { ...CREATED, format: 'slack', signingSecret: null } as const;
    const wrapper = dialog(stubClient({ createWebhookEndpoint: vi.fn(() => Promise.resolve(slack)) }));

    await submit(wrapper, { format: 'slack' });

    expect(wrapper.find('[data-secret]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Slack endpoints are not signed');
  });

  it('copies the secret and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const toasts = createToasts();
    const wrapper = dialog(stubClient({ createWebhookEndpoint: vi.fn(() => Promise.resolve(CREATED)) }), toasts);
    await submit(wrapper);

    await wrapper.find('button[data-action="copy"]').trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(toasts.toasts.value.map(({ text }) => text)).toEqual(['Signing secret copied']);
  });

  it('tells the user when the browser refuses to copy, leaving the secret selectable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) }, configurable: true });
    const toasts = createToasts();
    const wrapper = dialog(stubClient({ createWebhookEndpoint: vi.fn(() => Promise.resolve(CREATED)) }), toasts);
    await submit(wrapper);

    await wrapper.find('button[data-action="copy"]').trigger('click');
    await flushPromises();

    expect(toasts.toasts.value.map(({ kind }) => kind)).toEqual(['failure']);
    expect(wrapper.find('[data-secret]').text()).toBe(SECRET);
  });

  it('stays open on Escape and on a backdrop click while the secret is shown, so it cannot be lost by accident', async () => {
    const wrapper = dialog(stubClient({ createWebhookEndpoint: vi.fn(() => Promise.resolve(CREATED)) }));
    await submit(wrapper);

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    await wrapper.find('.modal-backdrop').trigger('click');

    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.find('[data-secret]').text()).toBe(SECRET);
  });

  it('stays open on Escape and on a backdrop click while the request is in flight, so a created secret is never lost unseen', async () => {
    let finish!: (created: CreatedWebhookEndpoint) => void;
    const createWebhookEndpoint = vi.fn(() => new Promise<CreatedWebhookEndpoint>((resolve) => (finish = resolve)));
    const wrapper = dialog(stubClient({ createWebhookEndpoint }));
    await wrapper.find('input[name="url"]').setValue(CREATED.url);
    await wrapper.find('form').trigger('submit');

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    await wrapper.find('.modal-backdrop').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();

    finish(CREATED);
    await flushPromises();
    expect(wrapper.find('[data-secret]').text()).toBe(SECRET);
  });

  it('moves focus to Done once the secret is shown', async () => {
    const wrapper = dialog(stubClient({ createWebhookEndpoint: vi.fn(() => Promise.resolve(CREATED)) }));

    await submit(wrapper);

    expect(document.activeElement).toBe(wrapper.find('button[data-action="done"]').element);
  });

  it('wraps Tab from Done back to Copy, so focus cannot leave the secret screen', async () => {
    const wrapper = dialog(stubClient({ createWebhookEndpoint: vi.fn(() => Promise.resolve(CREATED)) }));
    await submit(wrapper);

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Tab' });

    expect(document.activeElement).toBe(wrapper.find('button[data-action="copy"]').element);
  });

  it('closes on Escape before anything was created', async () => {
    const wrapper = dialog();

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('closes from the Done button', async () => {
    const wrapper = dialog(stubClient({ createWebhookEndpoint: vi.fn(() => Promise.resolve(CREATED)) }));
    await submit(wrapper);

    await wrapper.find('button[data-action="done"]').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('lists every problem the API reports and keeps the form for another try', async () => {
    const createWebhookEndpoint = vi.fn(() => Promise.reject(rejectedWith({ errors: ['url must be https', 'url must not be private'] })));
    const wrapper = dialog(stubClient({ createWebhookEndpoint }));

    await submit(wrapper, { url: 'http://10.0.0.1/hook' });

    expect(wrapper.findAll('[role="alert"] li').map((item) => item.text())).toEqual(['url must be https', 'url must not be private']);
    expect(wrapper.find('input[name="url"]').exists()).toBe(true);
    expect(wrapper.emitted('created')).toBeUndefined();
  });

  it('sends only once while a request is in flight', async () => {
    let finish!: (created: CreatedWebhookEndpoint) => void;
    const createWebhookEndpoint = vi.fn(() => new Promise<CreatedWebhookEndpoint>((resolve) => (finish = resolve)));
    const wrapper = dialog(stubClient({ createWebhookEndpoint }));
    await wrapper.find('input[name="url"]').setValue(CREATED.url);

    await wrapper.find('form').trigger('submit');
    await wrapper.find('form').trigger('submit');
    finish(CREATED);
    await flushPromises();

    expect(createWebhookEndpoint).toHaveBeenCalledOnce();
  });

  it('leaves no trace of the secret once it is closed', async () => {
    const wrapper = dialog(stubClient({ createWebhookEndpoint: vi.fn(() => Promise.resolve(CREATED)) }));
    await submit(wrapper);
    expect(document.body.textContent).toContain(SECRET);

    wrapper.unmount();

    expect(document.body.textContent).not.toContain(SECRET);
  });
});
