import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient, Snapshot } from '../api/client.js';
import { apiClientKey } from '../injection.js';
import { MONITOR, stubClient } from '../test-support.js';
import SnapshotView from './SnapshotView.vue';

const HASH = 'b'.repeat(64);

const SNAPSHOT: Snapshot = {
  hash: HASH,
  catalog: {
    tools: [
      { name: 'search', description: 'Searches the docs', inputSchema: { type: 'object' } },
      { name: 'fetch', description: '<script>alert("pwned")</script>', inputSchema: {} },
    ],
    prompts: [{ name: 'summarise', description: 'Summarises a page' }],
    resources: [{ uri: 'docs://index' }],
  },
};

async function view(client: ApiClient, hash: string | null = HASH) {
  const wrapper = mount(SnapshotView, { props: { monitorId: MONITOR.id, hash }, global: { provide: { [apiClientKey as symbol]: client } } });
  await flushPromises();
  return wrapper;
}

describe('SnapshotView', () => {
  it('reads the snapshot of the baseline hash it is given', async () => {
    const getSnapshot = vi.fn(() => Promise.resolve(SNAPSHOT));

    await view(stubClient({ getSnapshot }));

    expect(getSnapshot).toHaveBeenCalledWith(MONITOR.id, HASH);
  });

  it('lists the tools with their descriptions, then the prompts and resources', async () => {
    const wrapper = await view(stubClient({ getSnapshot: vi.fn(() => Promise.resolve(SNAPSHOT)) }));

    const tools = wrapper.findAll('[data-section="tools"] li');
    expect(tools.map((tool) => tool.find('.mono').text())).toEqual(['search', 'fetch']);
    expect(tools[0]?.text()).toContain('Searches the docs');
    expect(wrapper.find('[data-section="prompts"]').text()).toContain('summarise');
    expect(wrapper.find('[data-section="prompts"]').text()).toContain('Summarises a page');
    expect(wrapper.find('[data-section="resources"]').text()).toContain('docs://index');
  });

  it('renders descriptions as text, so <script> appears literally', async () => {
    const wrapper = await view(stubClient({ getSnapshot: vi.fn(() => Promise.resolve(SNAPSHOT)) }));

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.text()).toContain('<script>alert("pwned")</script>');
    expect(wrapper.html()).toContain('&lt;script&gt;');
  });

  it('renders prompt names and resource URIs as text too', async () => {
    const hostile: Snapshot = {
      hash: HASH,
      catalog: { tools: [], prompts: [{ name: '<b>bold</b>', description: '' }], resources: [{ uri: 'javascript:alert(1)' }] },
    };

    const wrapper = await view(stubClient({ getSnapshot: vi.fn(() => Promise.resolve(hostile)) }));

    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.text()).toContain('<b>bold</b>');
    expect(wrapper.text()).toContain('javascript:alert(1)');
  });

  it('says so for a catalog with nothing in a section', async () => {
    const empty: Snapshot = { hash: HASH, catalog: { tools: [], prompts: [], resources: [] } };

    const wrapper = await view(stubClient({ getSnapshot: vi.fn(() => Promise.resolve(empty)) }));

    expect(wrapper.find('[data-section="tools"]').text()).toContain('No tools');
  });

  it('does not ask for a snapshot before a baseline exists', async () => {
    const getSnapshot = vi.fn(() => Promise.resolve(SNAPSHOT));

    const wrapper = await view(stubClient({ getSnapshot }), null);

    expect(getSnapshot).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('No baseline yet');
  });

  it('shows the problem when the snapshot cannot be read', async () => {
    const wrapper = await view(stubClient({ getSnapshot: vi.fn(() => Promise.reject(new Error('boom'))) }));

    expect(wrapper.find('[role="alert"]').text()).toContain('boom');
  });
});
