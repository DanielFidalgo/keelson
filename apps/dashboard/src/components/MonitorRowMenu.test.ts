import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import type { MonitorWithSummary } from '../api/client.js';
import { createAppRouter } from '../router.js';
import { MONITOR_WITH_SUMMARY, SUMMARY } from '../test-support.js';
import MonitorRowMenu from './MonitorRowMenu.vue';

const drifted: MonitorWithSummary = { ...MONITOR_WITH_SUMMARY, summary: { ...SUMMARY, health: 'drift' } };
const paused: MonitorWithSummary = { ...MONITOR_WITH_SUMMARY, status: 'paused', summary: { ...SUMMARY, health: 'paused' } };

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function menu(monitor: MonitorWithSummary = MONITOR_WITH_SUMMARY) {
  const router = createAppRouter(createMemoryHistory());
  await router.push('/monitors');
  return mount(MonitorRowMenu, { props: { monitor }, attachTo: document.body, global: { plugins: [router] } });
}

const trigger = (wrapper: Awaited<ReturnType<typeof menu>>) => wrapper.find('button[aria-haspopup="menu"]');
const labels = (wrapper: Awaited<ReturnType<typeof menu>>) => wrapper.findAll('[role="menuitem"]').map((item) => item.text());

async function open(monitor?: MonitorWithSummary) {
  const wrapper = await menu(monitor);
  await trigger(wrapper).trigger('click');
  await flushPromises();
  return wrapper;
}

describe('MonitorRowMenu', () => {
  it('is closed until its button is pressed, and the button names the monitor', async () => {
    const wrapper = await menu();

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(trigger(wrapper).attributes('aria-label')).toBe('Actions for Docs');
    expect(trigger(wrapper).attributes('aria-expanded')).toBe('false');
  });

  it('opens on the button and puts focus on the first item', async () => {
    const wrapper = await open();

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(wrapper.find('[role="menuitem"]').element);
  });

  it('focuses the first item without scrolling, which would trip the scroll listener that closes the menu', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation((options?: FocusOptions) => {
      // A browser scrolls the focused item into view unless told not to, and that scroll closes the menu.
      if (options?.preventScroll !== true) window.dispatchEvent(new Event('scroll'));
    });

    const wrapper = await open();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
  });

  it('offers only probe history, pause and delete for a monitor that is not drifted', async () => {
    const wrapper = await open();

    expect(labels(wrapper)).toEqual(['Probe history', 'Pause monitoring', 'Delete monitor']);
  });

  it('adds Review drift and Approve new baseline for a drifted monitor', async () => {
    const wrapper = await open(drifted);

    expect(labels(wrapper)).toEqual(['Review drift', 'Approve new baseline', 'Probe history', 'Pause monitoring', 'Delete monitor']);
  });

  it('offers Resume instead of Pause for a paused monitor', async () => {
    const wrapper = await open(paused);

    expect(labels(wrapper)).toContain('Resume monitoring');
    expect(labels(wrapper)).not.toContain('Pause monitoring');
  });

  it('links the drift and probe history entries to the matching tab of the monitor', async () => {
    const wrapper = await open(drifted);

    const hrefs = wrapper.findAll('a[role="menuitem"]').map((link) => link.attributes('href'));
    expect(hrefs).toEqual(['/monitors/mon_1?tab=drift', '/monitors/mon_1?tab=probes']);
  });

  it.each([
    ['Approve new baseline', 'approve'],
    ['Pause monitoring', 'pause'],
    ['Delete monitor', 'delete'],
  ])('reports %s and closes', async (label, event) => {
    const wrapper = await open(drifted);

    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === label)?.trigger('click');

    expect(wrapper.emitted(event)).toHaveLength(1);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('reports Resume', async () => {
    const wrapper = await open(paused);

    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Resume monitoring')?.trigger('click');

    expect(wrapper.emitted('resume')).toHaveLength(1);
  });

  it('hands focus back to its button when an item is chosen, so a dialog opened next returns there', async () => {
    const wrapper = await open();

    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Delete monitor')?.trigger('click');

    expect(document.activeElement).toBe(trigger(wrapper).element);
  });

  it('closes on Escape and returns focus to its button', async () => {
    const wrapper = await open();

    await wrapper.find('[role="menuitem"]').trigger('keydown', { key: 'Escape' });

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger(wrapper).element);
  });

  it('moves between items with the arrow keys, wrapping at both ends', async () => {
    const wrapper = await open();
    const items = wrapper.findAll('[role="menuitem"]');

    await items[0]?.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]?.element);

    await items[1]?.trigger('keydown', { key: 'ArrowUp' });
    await items[0]?.trigger('keydown', { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items.at(-1)?.element);

    await items.at(-1)?.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]?.element);
  });

  it('closes when the pointer goes down outside it', async () => {
    const wrapper = await open();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('stays open when the pointer goes down inside it', async () => {
    const wrapper = await open();

    await wrapper.find('[role="menu"]').trigger('pointerdown');

    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
  });

  it('closes when focus moves to something outside it', async () => {
    const wrapper = await open();
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);

    elsewhere.focus();
    await flushPromises();

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('renders a hostile monitor name as text', async () => {
    const wrapper = await menu({ ...MONITOR_WITH_SUMMARY, name: '<img src=x onerror=alert(1)>' });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(trigger(wrapper).attributes('aria-label')).toBe('Actions for <img src=x onerror=alert(1)>');
  });
});
