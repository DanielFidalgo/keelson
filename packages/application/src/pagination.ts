import { MAX_PAGE_LIMIT, type Page, type PageRequest } from './ports.js';

// Keyset paging over an already ordered list: the cursor is the key of the last item returned, so
// inserts between requests never shift a page the way an offset would.
export function paginate<T>(ordered: readonly T[], page: PageRequest, keyOf: (item: T) => string): Page<T> {
  const start = startIndex(ordered, page.cursor, keyOf);
  if (start === null) return { items: [], nextCursor: null };
  const limit = Math.min(page.limit, MAX_PAGE_LIMIT);
  const items = ordered.slice(start, start + limit);
  const last = items.at(-1);
  const hasMore = last !== undefined && start + limit < ordered.length;
  return { items, nextCursor: hasMore ? keyOf(last) : null };
}

function startIndex<T>(ordered: readonly T[], cursor: string | null, keyOf: (item: T) => string): number | null {
  if (cursor === null) return 0;
  const cursorIndex = ordered.findIndex((item) => keyOf(item) === cursor);
  return cursorIndex === -1 ? null : cursorIndex + 1;
}
