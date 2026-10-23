export interface PageCursor {
  sortKey: string;
  id: string;
}

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

// A token that does not decode is treated like a cursor that matches nothing, which is how the in-memory adapters behave.
export function decodeCursor(token: string): PageCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    return isPageCursor(parsed) ? { sortKey: parsed.sortKey, id: parsed.id } : null;
  } catch {
    return null;
  }
}

function isPageCursor(value: unknown): value is PageCursor {
  if (typeof value !== 'object' || value === null) return false;
  return 'sortKey' in value && typeof value.sortKey === 'string' && 'id' in value && typeof value.id === 'string';
}
