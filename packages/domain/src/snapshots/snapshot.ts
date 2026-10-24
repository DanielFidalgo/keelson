import { createHash } from 'node:crypto';
import { DomainValidationError } from '../shared/errors.js';
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

const SNAPSHOT_HASH_PATTERN = /^[0-9a-f]{64}$/;

// The only way to turn untrusted text into a SnapshotHash, so the brand cannot be forged by a cast at the edge.
export function parseSnapshotHash(value: string): SnapshotHash {
  if (!SNAPSHOT_HASH_PATTERN.test(value)) {
    throw new DomainValidationError(['snapshot hash must be 64 lowercase hex characters']);
  }
  return value as SnapshotHash;
}
