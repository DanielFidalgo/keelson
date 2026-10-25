import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { ApiError } from '../api/client.js';
import { createApiKeyStore } from '../api/api-key-store.js';
import { useListQuery } from './useListQuery.js';

interface Filters extends Record<string, string | null> {
  health: string | null;
  q: string;
}

const DEFAULTS: Filters = { health: null, q: '' };
const PAGE_SIZES = [10, 20, 50] as const;
const TOTAL = 45;

type Load = Parameters<typeof useListQuery<Filters, string>>[0]['load'];

// A server holding TOTAL rows: the cursor of the page after "c<n>" is "c<n+1>", and the first page has no cursor.
function pagedLoad(): ReturnType<typeof vi.fn<Load>> {
  return vi.fn<Load>(({ cursor, limit }) => {
    const offset = cursor === null ? 0 : Number(cursor.slice(1)) * limit;
    const count = Math.min(limit, TOTAL - offset);
    const pageNumber = cursor === null ? 1 : Number(cursor.slice(1)) + 1;
    const nextCursor = offset + count < TOTAL ? `c${String(pageNumber)}` : null;
    return Promise.resolve({ items: Array.from({ length: count }, (_, index) => `row ${String(offset + index)}`), nextCursor, total: TOTAL });
  });
}

let mounted: VueWrapper | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

async function mountList(load: Load, { path = '/monitors', refreshMs }: { path?: string; refreshMs?: number } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/monitors', component: { render: () => h('div') } },
      { path: '/elsewhere', component: { render: () => h('div') } },
    ],
  });
  await router.push(path);
  let list!: ReturnType<typeof useListQuery<Filters, string>>;
  const host = defineComponent({
    setup() {
      list = useListQuery<Filters, string>({ defaults: DEFAULTS, pageSizes: PAGE_SIZES, load, ...(refreshMs === undefined ? {} : { refreshMs }) });
      return () => h('div');
    },
  });
  mounted = mount(host, { global: { plugins: [router] } });
  await flushPromises();
  return { list, router, query: () => router.currentRoute.value.query };
}

describe('useListQuery', () => {
  it('loads the first page with the default size when the URL carries nothing', async () => {
    const load = pagedLoad();

    const { list } = await mountList(load);

    expect(load).toHaveBeenCalledExactlyOnceWith({ filters: DEFAULTS, cursor: null, limit: 20 });
    expect(list.items).toHaveLength(20);
    expect(list.total).toBe(TOTAL);
  });

  it('walks forward with next and back with previous along the cursors it has seen', async () => {
    const load = pagedLoad();
    const { list, query } = await mountList(load, { path: '/monitors?limit=10' });

    list.next();
    await flushPromises();
    list.next();
    await flushPromises();
    expect([list.page, query().cursor]).toEqual([3, 'c2']);
    expect(load).toHaveBeenLastCalledWith({ filters: DEFAULTS, cursor: 'c2', limit: 10 });

    list.previous();
    await flushPromises();
    expect([list.page, query().cursor]).toEqual([2, 'c1']);

    list.previous();
    await flushPromises();
    expect([list.page, query().cursor, query().page]).toEqual([1, undefined, undefined]);
    expect(list.hasPrevious).toBe(false);
  });

  it('offers Next only while the API reports another page', async () => {
    const { list } = await mountList(pagedLoad(), { path: '/monitors?limit=50' });

    expect(list.hasNext).toBe(false);
    expect(list.hasPrevious).toBe(false);
  });

  it('returns to page 1 and forgets the cursors when a filter changes on page 3', async () => {
    const load = pagedLoad();
    const { list, query } = await mountList(load, { path: '/monitors?limit=10' });
    list.next();
    await flushPromises();
    list.next();
    await flushPromises();

    list.setFilter('health', 'drift');
    await flushPromises();

    expect(list.page).toBe(1);
    expect(query()).toEqual({ limit: '10', health: 'drift' });
    expect(load).toHaveBeenLastCalledWith({ filters: { health: 'drift', q: '' }, cursor: null, limit: 10 });

    list.next();
    await flushPromises();
    list.previous();
    await flushPromises();
    expect([list.page, query().cursor]).toEqual([1, undefined]);
  });

  it('forgets the cursors of the old filter when Back and Forward change the filter instead of setFilter', async () => {
    // Cursors name their filter, so a cursor carried over from another filter is visible in the request.
    const load = vi.fn<Load>(({ filters, cursor }) => {
      const walked = cursor === null ? 0 : Number(cursor.split(':')[1]);
      return Promise.resolve({ items: ['row'], nextCursor: `${String(filters.health)}:${String(walked + 1)}`, total: 100 });
    });
    const { list, router, query } = await mountList(load, { path: '/monitors?health=a&limit=10' });
    list.next();
    await flushPromises();
    list.next();
    await flushPromises();
    list.setFilter('health', 'b');
    await flushPromises();
    list.next();
    await flushPromises();

    router.back();
    await flushPromises();
    router.back();
    await flushPromises();
    expect([list.filters.health, list.page, query().cursor]).toEqual(['a', 3, 'a:2']);

    list.previous();
    await flushPromises();

    expect(load).toHaveBeenLastCalledWith({ filters: { health: 'a', q: '' }, cursor: null, limit: 10 });
    expect([list.page, query().cursor]).toEqual([1, undefined]);
  });

  it('returns to page 1 when the page size changes', async () => {
    const load = pagedLoad();
    const { list, query } = await mountList(load, { path: '/monitors?limit=10' });
    list.next();
    await flushPromises();

    list.setPageSize(50);
    await flushPromises();

    expect(query()).toEqual({ limit: '50' });
    expect(list.pageSize).toBe(50);
    expect(list.page).toBe(1);
  });

  it('keeps defaults out of the URL and other query keys in it', async () => {
    const { list, query } = await mountList(pagedLoad(), { path: '/monitors?tab=history' });

    list.setFilter('q', 'docs');
    await flushPromises();
    list.setFilter('q', '');
    await flushPromises();

    expect(query()).toEqual({ tab: 'history' });
  });

  it('writes only filters, page, limit and cursor to the URL, never the API key', async () => {
    const storage = window.sessionStorage;
    storage.clear();
    createApiKeyStore(storage).save('key_secret_value');
    const { list, router } = await mountList(pagedLoad(), { path: '/monitors?limit=10' });

    list.setFilter('q', 'docs');
    await flushPromises();
    list.next();
    await flushPromises();

    const { query, fullPath } = router.currentRoute.value;
    expect(Object.keys(query).sort()).toEqual(['cursor', 'limit', 'page', 'q']);
    expect(fullPath).not.toContain('key_secret_value');
    storage.clear();
  });

  it('restores a pasted link, counting the range from its page', async () => {
    const { list } = await mountList(pagedLoad(), { path: '/monitors?page=3&cursor=c2&limit=10&health=up' });

    expect(list.page).toBe(3);
    expect(list.filters.health).toBe('up');
    expect(list.rangeLabel).toBe('Showing 21-30 of 45');
  });

  it('falls back to the first page when Previous is pressed on a link whose earlier cursors are unknown', async () => {
    const { list, query } = await mountList(pagedLoad(), { path: '/monitors?page=3&cursor=c2&limit=10' });

    list.previous();
    await flushPromises();

    expect([list.page, query().cursor]).toEqual([1, undefined]);
  });

  it('treats a page without a cursor, or an unknown size, as the defaults', async () => {
    const { list } = await mountList(pagedLoad(), { path: '/monitors?page=4&limit=7' });

    expect([list.page, list.pageSize]).toEqual([1, 20]);
  });

  it('words the range on the first, a middle and the last page', async () => {
    const { list } = await mountList(pagedLoad(), { path: '/monitors?limit=20' });
    expect(list.rangeLabel).toBe('Showing 1-20 of 45');

    list.next();
    await flushPromises();
    expect(list.rangeLabel).toBe('Showing 21-40 of 45');

    list.next();
    await flushPromises();
    expect(list.rangeLabel).toBe('Showing 41-45 of 45');
  });

  it('says so when there is nothing to show', async () => {
    const load = vi.fn<Load>(() => Promise.resolve({ items: [], nextCursor: null, total: 0 }));

    const { list } = await mountList(load);

    expect(list.rangeLabel).toBe('Showing 0 of 0');
  });

  it('shows the API problem when loading fails, and recovers on refresh', async () => {
    const problem = { type: 'about:blank', title: 'Bad', status: 400, detail: 'The request is not valid.' };
    const load = pagedLoad();
    load.mockRejectedValueOnce(new ApiError(problem));

    const { list } = await mountList(load);
    expect(list.error).toBe('The request is not valid.');
    expect(list.loading).toBe(false);

    await list.refresh();
    expect(list.error).toBeNull();
    expect(list.items).toHaveLength(20);
  });

  it('keeps the last items, total and paging when a refresh of the same view fails', async () => {
    const load = pagedLoad();
    const { list } = await mountList(load);
    load.mockRejectedValueOnce(new Error('offline'));

    await list.refresh();

    expect(list.error).toContain('offline');
    expect(list.items).toHaveLength(20);
    expect(list.total).toBe(TOTAL);
    expect(list.hasNext).toBe(true);
  });

  it('drops the items of the old view when loading a different one fails', async () => {
    const load = pagedLoad();
    const { list } = await mountList(load);
    load.mockRejectedValueOnce(new Error('offline'));

    list.setFilter('q', 'new');
    await flushPromises();

    expect(list.error).toContain('offline');
    expect(list.items).toEqual([]);
    expect(list.total).toBe(0);
    expect(list.hasNext).toBe(false);
  });

  it('ignores an answer that arrives after a newer request', async () => {
    const answers: ((value: Awaited<ReturnType<Load>>) => void)[] = [];
    const load = vi.fn<Load>(() => new Promise((resolve) => answers.push(resolve)));
    const { list } = await mountList(load);

    list.setFilter('q', 'new');
    await flushPromises();
    answers[1]?.({ items: ['new'], nextCursor: null, total: 1 });
    await flushPromises();
    answers[0]?.({ items: ['old'], nextCursor: null, total: 1 });
    await flushPromises();

    expect(list.items).toEqual(['new']);
  });

  it('does not reload when the route leaves the page', async () => {
    const load = pagedLoad();
    const { router } = await mountList(load);

    await router.push('/elsewhere?q=x');
    await flushPromises();

    expect(load).toHaveBeenCalledOnce();
  });

  describe('refreshAfterChange', () => {
    const emptied = { items: [], nextCursor: null, total: 20 };

    it('steps back a page when the change left the last page empty', async () => {
      const load = vi
        .fn<Load>()
        .mockResolvedValueOnce({ items: ['row 20'], nextCursor: null, total: 21 })
        .mockResolvedValueOnce(emptied)
        .mockResolvedValue({ items: ['row 19'], nextCursor: 'c1', total: 20 });
      const { list, query } = await mountList(load, { path: '/monitors?page=2&cursor=c1' });

      await list.refreshAfterChange();
      await flushPromises();

      expect(query()).toEqual({});
      expect(load).toHaveBeenLastCalledWith({ filters: DEFAULTS, cursor: null, limit: 20 });
    });

    it('stays on the first page when it is empty', async () => {
      const load = vi.fn<Load>().mockResolvedValueOnce({ items: ['row 0'], nextCursor: null, total: 1 }).mockResolvedValue({ ...emptied, total: 0 });
      const { list } = await mountList(load);

      await list.refreshAfterChange();
      await flushPromises();

      expect(load).toHaveBeenCalledTimes(2);
      expect(list.items).toEqual([]);
    });

    it('stays put when the reload failed rather than mistaking the failure for an empty page', async () => {
      const load = vi
        .fn<Load>()
        .mockResolvedValueOnce({ items: ['row 20'], nextCursor: null, total: 21 })
        .mockRejectedValue(new Error('offline'));
      const { list, query } = await mountList(load, { path: '/monitors?page=2&cursor=c1' });

      await list.refreshAfterChange();
      await flushPromises();

      expect(query()).toEqual({ page: '2', cursor: 'c1' });
      expect(list.error).not.toBeNull();
    });
  });

  describe('refresh timer', () => {
    const REFRESH_MS = 60_000;

    function hideTab(state: DocumentVisibilityState) {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }

    it('refreshes on every tick while the tab is visible', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const load = pagedLoad();
      await mountList(load);

      await vi.advanceTimersByTimeAsync(REFRESH_MS);
      await vi.advanceTimersByTimeAsync(REFRESH_MS);

      expect(load).toHaveBeenCalledTimes(3);
    });

    it('stops while the tab is hidden and refreshes at once when it is visible again', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const load = pagedLoad();
      await mountList(load);

      hideTab('hidden');
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
      expect(load).toHaveBeenCalledOnce();

      hideTab('visible');
      await vi.advanceTimersByTimeAsync(0);
      expect(load).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(REFRESH_MS);
      expect(load).toHaveBeenCalledTimes(3);
    });

    it('stops after unmount', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const load = pagedLoad();
      await mountList(load);

      mounted?.unmount();
      mounted = undefined;
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);

      expect(load).toHaveBeenCalledOnce();
    });

    it('follows the refreshMs option', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const load = pagedLoad();
      await mountList(load, { refreshMs: 5_000 });

      await vi.advanceTimersByTimeAsync(5_000);

      expect(load).toHaveBeenCalledTimes(2);
    });
  });
});
