import type { ClientBase } from 'pg';

// The slice of a pool or checked-out client the repositories use, so the same code runs inside or outside a transaction.
export type Queryable = Pick<ClientBase, 'query'>;

export interface RepositoryDeps {
  db: Queryable;
}

export function firstOrNull<Row, Item>(rows: readonly Row[], toItem: (row: Row) => Item): Item | null {
  const [row] = rows;
  return row === undefined ? null : toItem(row);
}
