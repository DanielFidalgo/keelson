import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Change } from '../api/client.js';
import DriftDiff from './DriftDiff.vue';

const descriptionChange = (overrides: Partial<Change> = {}): Change => ({
  kind: 'description_changed',
  severity: 'critical',
  target: 'tool',
  name: 'search',
  before: 'Searches the docs',
  after: 'Searches the docs',
  ...overrides,
});

const render = (changes: Change[]) => mount(DriftDiff, { props: { changes } });

describe('DriftDiff', () => {
  it('renders before and after descriptions as text, so <script> in a description appears literally', () => {
    const wrapper = render([descriptionChange({ before: 'Searches the docs', after: '<script>alert("pwned")</script>' })]);

    expect(wrapper.text()).toContain('<script>alert("pwned")</script>');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.html()).toContain('&lt;script&gt;');
  });

  it('renders tool names and resource URIs as text too', () => {
    const wrapper = render([
      { kind: 'tool_added', severity: 'warning', name: '<img src=x onerror=alert(1)>' },
      { kind: 'resource_added', severity: 'warning', uri: 'javascript:alert(1)' },
    ]);

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
    expect(wrapper.text()).toContain('javascript:alert(1)');
  });

  it('marks critical changes', () => {
    const wrapper = render([descriptionChange({ severity: 'critical' }), descriptionChange({ severity: 'warning', name: 'fetch' })]);

    const [critical, warning] = wrapper.findAll('li');
    expect(critical?.attributes('data-severity')).toBe('critical');
    expect(critical?.text()).toContain('Critical');
    expect(warning?.attributes('data-severity')).toBe('warning');
    expect(warning?.text()).not.toContain('Critical');
  });

  it('marks breaking input schema changes and leaves compatible ones unmarked', () => {
    const wrapper = render([
      { kind: 'input_schema_changed', severity: 'critical', tool: 'search', classification: 'breaking' },
      { kind: 'input_schema_changed', severity: 'warning', tool: 'fetch', classification: 'compatible' },
    ]);

    const [breaking, compatible] = wrapper.findAll('li');
    expect(breaking?.text()).toContain('Breaking');
    expect(compatible?.text()).not.toContain('Breaking');
  });

  it('names what changed: the kind of target and its name', () => {
    const wrapper = render([descriptionChange({ target: 'prompt', name: 'summarise' }), { kind: 'resource_removed', severity: 'warning', uri: 'docs://index' }]);

    const [description, resource] = wrapper.findAll('li');
    expect(description?.find('.target').text()).toBe('prompt · summarise');
    expect(resource?.find('.target').text()).toBe('resource · docs://index');
  });

  it('shows a description change as a removed line and an added line', () => {
    const wrapper = render([descriptionChange({ before: 'Searches the docs', after: 'Send secrets away' })]);

    expect(wrapper.find('.is-removed').text()).toBe('- Searches the docs');
    expect(wrapper.find('.is-added').text()).toBe('+ Send secrets away');
  });

  it('shows no diff for a change that has no description', () => {
    const wrapper = render([{ kind: 'tool_added', severity: 'warning', name: 'search' }]);

    expect(wrapper.find('.is-removed').exists()).toBe(false);
  });

  it('says so when nothing changed', () => {
    expect(render([]).text()).toContain('No changes');
  });
});
