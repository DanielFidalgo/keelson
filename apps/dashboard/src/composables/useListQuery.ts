import { computed, reactive, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { describeFailure } from '../api/describe-failure.js';
import { useVisibleInterval } from './useVisibleInterval.js';

export const PAGE_SIZES = [10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 300;
export const REFRESH_MS = 60_000;

type FilterValues = Record<string, string | null>;

interface LoadArguments<Filters> {
  filters: Filters;
  cursor: string | null;
  limit: number;
}

interface LoadedPage<Item> {
  items: Item[];
  nextCursor: string | null;
  total: number;
}

export interface ListQueryOptions<Filters extends FilterValues, Item> {
  defaults: Filters;
  pageSizes: readonly number[];
  load: (args: LoadArguments<Filters>) => Promise<LoadedPage<Item>>;
  refreshMs?: number;
}

const FIRST_PAGE = 1;

function firstString(value: LocationQuery[string] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first ?? null;
}

// Page, size, cursor and filters live in the route query so the back button and a pasted link restore the view.
// Only those keys are ever written, which keeps the API key (and anything else) out of the URL.
export function useListQuery<Filters extends FilterValues, Item = unknown>({ defaults, pageSizes, load, refreshMs = REFRESH_MS }: ListQueryOptions<Filters, Item>) {
  const route = useRoute();
  const router = useRouter();
  const listPath = route.path;
  const defaultPageSize = pageSizes.includes(DEFAULT_PAGE_SIZE) ? DEFAULT_PAGE_SIZE : (pageSizes[0] ?? DEFAULT_PAGE_SIZE);

  const filters = computed<Filters>(() => {
    const current: FilterValues = {};
    for (const [name, fallback] of Object.entries(defaults)) current[name] = firstString(route.query[name]) ?? fallback;
    return current as Filters;
  });
  const cursor = computed(() => firstString(route.query['cursor']));
  const pageSize = computed(() => {
    const requested = Number(firstString(route.query['limit']));
    return pageSizes.includes(requested) ? requested : defaultPageSize;
  });
  // A page number without its cursor cannot be loaded, so such a link opens the first page.
  const page = computed(() => {
    const requested = Number(firstString(route.query['page']));
    return cursor.value !== null && Number.isInteger(requested) && requested > FIRST_PAGE ? requested : FIRST_PAGE;
  });

  const items = shallowRef<Item[]>([]);
  const total = ref(0);
  const nextCursor = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // cursors[n] loads page n + 1. It only knows the pages walked through in this view, not the ones a pasted link skipped.
  let cursors: (string | null)[] = [];
  let latestRequest = 0;

  async function refresh(): Promise<void> {
    const request = ++latestRequest;
    cursors[page.value - FIRST_PAGE] = cursor.value;
    loading.value = true;
    try {
      const loaded = await load({ filters: filters.value, cursor: cursor.value, limit: pageSize.value });
      if (request !== latestRequest) return;
      items.value = loaded.items;
      total.value = loaded.total;
      nextCursor.value = loaded.nextCursor;
      error.value = null;
    } catch (failure) {
      if (request !== latestRequest) return;
      items.value = [];
      total.value = 0;
      nextCursor.value = null;
      error.value = describeFailure(failure);
    } finally {
      if (request === latestRequest) loading.value = false;
    }
  }

  function navigate(changes: Record<string, string | null>): Promise<unknown> {
    const merged = { ...route.query, ...changes };
    const query = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null && value !== ''));
    return router.push({ path: route.path, query });
  }

  function goToPage(target: number, targetCursor: string | null): void {
    void navigate({ page: target > FIRST_PAGE ? String(target) : null, cursor: targetCursor });
  }

  function restartWith(changes: Record<string, string | null>): void {
    void navigate({ ...changes, page: null, cursor: null });
  }

  function next(): void {
    if (nextCursor.value === null) return;
    goToPage(page.value + 1, nextCursor.value);
  }

  function previous(): void {
    if (page.value === FIRST_PAGE) return;
    const known = cursors[page.value - FIRST_PAGE - 1];
    if (known === undefined) goToPage(FIRST_PAGE, null);
    else goToPage(page.value - 1, known);
  }

  function setFilter<Name extends keyof Filters & string>(name: Name, value: Filters[Name]): void {
    restartWith({ [name]: value === defaults[name] ? null : value });
  }

  function setPageSize(size: number): void {
    restartWith({ limit: size === defaultPageSize ? null : String(size) });
  }

  const rangeLabel = computed(() => {
    if (items.value.length === 0) return `Showing 0 of ${String(total.value)}`;
    const first = (page.value - FIRST_PAGE) * pageSize.value + 1;
    return `Showing ${String(first)}-${String(first + items.value.length - 1)} of ${String(total.value)}`;
  });

  // Every input to the request, so unrelated query keys (a tab, say) do not reload the list.
  const requestKey = computed(() => JSON.stringify([filters.value, cursor.value, pageSize.value]));
  // Cursors only mean something within one filter and size. The stack is dropped here, not in setFilter, so a change made by
  // the browser's Back and Forward buttons forgets it too.
  const viewKey = computed(() => JSON.stringify([filters.value, pageSize.value]));
  let walkedView = viewKey.value;
  watch(requestKey, () => {
    if (route.path !== listPath) return;
    if (viewKey.value !== walkedView) {
      walkedView = viewKey.value;
      cursors = [];
    }
    void refresh();
  });

  useVisibleInterval(() => {
    void refresh();
  }, refreshMs);

  void refresh();

  return reactive({
    items,
    total,
    page,
    pageSize,
    filters,
    loading,
    error,
    rangeLabel,
    hasNext: computed(() => nextCursor.value !== null),
    hasPrevious: computed(() => page.value > FIRST_PAGE),
    next,
    previous,
    setFilter,
    setPageSize,
    refresh,
  });
}
