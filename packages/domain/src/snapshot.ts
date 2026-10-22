import { createHash } from 'node:crypto';
import { canonicalise, type CanonicalCatalog, type RawCatalog } from './catalog.js';
import { sortKeysRecursively, type JsonValue } from './json.js';

export type SnapshotHash = string & { readonly __brand: 'SnapshotHash' };

export interface Snapshot {
  readonly hash: SnapshotHash;
  readonly catalog: CanonicalCatalog;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortKeysRecursively(value));
}

export function createSnapshot(raw: RawCatalog): Snapshot {
  const catalog = canonicalise(raw);
  const hash = createHash('sha256').update(canonicalJson(catalog)).digest('hex') as SnapshotHash;
  return { hash, catalog };
}
