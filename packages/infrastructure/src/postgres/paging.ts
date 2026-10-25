import { MAX_PAGE_LIMIT, type CountedPage, type Page, type PageRequest } from '@keelson/application';
import type { QueryResultRow } from 'pg';
import { decodeCursor, encodeCursor } from './cursor.js';
import type { Queryable } from './queryable.js';

export interface PageSource<Row> {
  // A complete select with its joins; filters are added to it, so it must not already end in a where clause.
  select: string;
  // A complete, cheaper select of the same rows for counting, when `select` joins in columns only the page needs.
  countSelect?: string;
  conditions: string[];
  values: unknown[];
  // Pages run newest first on the sort column, then on the id so rows that share a sort value keep a stable order.
  sortColumn: string;
  sortType: 'timestamptz' | 'integer';
  idColumn: string;
  sortKeyOf: (row: Row) => string;
}

export async function selectPage<Row extends QueryResultRow & { id: string }, Item>(
  db: Queryable,
  source: PageSource<Row>,
  request: PageRequest,
  toItem: (row: Row) => Item,
): Promise<Page<Item>> {
  const conditions = [...source.conditions];
  const values = [...source.values];
  if (request.cursor !== null) {
    const cursor = decodeCursor(request.cursor);
    if (cursor === null) return { items: [], nextCursor: null };
    values.push(cursor.sortKey, cursor.id);
    const sortPlaceholder = `$${String(values.length - 1)}::${source.sortType}`;
    const idPlaceholder = `$${String(values.length)}`;
    conditions.push(`(${source.sortColumn}, ${source.idColumn}) < (${sortPlaceholder}, ${idPlaceholder})`);
  }

  const limit = Math.min(request.limit, MAX_PAGE_LIMIT);
  // One row beyond the page tells whether another page exists without a count query.
  values.push(limit + 1);
  const sql = `${source.select}${whereClause(conditions)} order by ${source.sortColumn} desc, ${source.idColumn} desc limit $${String(values.length)}`;
  const { rows } = await db.query<Row>(sql, values);

  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const hasMore = rows.length > limit;
  return {
    items: pageRows.map(toItem),
    nextCursor: hasMore && last !== undefined ? encodeCursor({ sortKey: source.sortKeyOf(last), id: last.id }) : null,
  };
}

// The total counts the filtered set, so it ignores the cursor and stays the same on every page of one listing.
export async function selectCountedPage<Row extends QueryResultRow & { id: string }, Item>(
  db: Queryable,
  source: PageSource<Row>,
  request: PageRequest,
  toItem: (row: Row) => Item,
): Promise<CountedPage<Item>> {
  const page = await selectPage(db, source, request, toItem);
  const matching = `${source.countSelect ?? source.select}${whereClause(source.conditions)}`;
  const { rows } = await db.query<{ total: number }>(`select count(*)::int as total from (${matching}) matching`, source.values);
  return { ...page, total: rows[0]?.total ?? 0 };
}

function whereClause(conditions: readonly string[]): string {
  return conditions.length === 0 ? '' : ` where ${conditions.join(' and ')}`;
}
