import { CatalogError } from './errors.js';
import { compareCodeUnits, isJsonObject, sortKeysRecursively, type JsonSchema, type JsonValue } from './json.js';

export interface RawCatalog {
  tools: unknown[];
  prompts: unknown[];
  resources: unknown[];
}

export type CanonicalTool = { name: string; description: string; inputSchema: JsonSchema };
export type CanonicalPrompt = { name: string; description: string };
export type CanonicalResource = { uri: string };
export type CanonicalCatalog = {
  tools: CanonicalTool[];
  prompts: CanonicalPrompt[];
  resources: CanonicalResource[];
};

type RawEntry = Record<string, unknown>;

export function canonicalise(raw: RawCatalog): CanonicalCatalog {
  return {
    tools: canonicaliseList(raw.tools, 'tool', (tool) => tool.name, toCanonicalTool),
    prompts: canonicaliseList(raw.prompts, 'prompt', (prompt) => prompt.name, toCanonicalPrompt),
    resources: canonicaliseList(raw.resources, 'resource', (resource) => resource.uri, toCanonicalResource),
  };
}

function toCanonicalTool(entry: RawEntry): CanonicalTool {
  return {
    name: requireString(entry, 'name', 'tool'),
    description: optionalText(entry, 'description', 'tool'),
    inputSchema: canonicaliseSchema(entry['inputSchema']),
  };
}

function toCanonicalPrompt(entry: RawEntry): CanonicalPrompt {
  return {
    name: requireString(entry, 'name', 'prompt'),
    description: optionalText(entry, 'description', 'prompt'),
  };
}

function toCanonicalResource(entry: RawEntry): CanonicalResource {
  return { uri: requireString(entry, 'uri', 'resource') };
}

function canonicaliseList<T>(
  rawEntries: unknown[],
  kind: string,
  identityOf: (item: T) => string,
  build: (entry: RawEntry) => T,
): T[] {
  const items = rawEntries.map((rawEntry) => build(asEntry(rawEntry, kind)));
  const seen = new Set<string>();
  for (const item of items) {
    const identity = identityOf(item);
    if (seen.has(identity)) throw new CatalogError(`duplicate ${kind}: ${identity}`);
    seen.add(identity);
  }
  return items.sort((left, right) => compareCodeUnits(identityOf(left), identityOf(right)));
}

function asEntry(value: unknown, kind: string): RawEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CatalogError(`${kind} entry must be an object`);
  }
  return value as RawEntry;
}

function requireString(entry: RawEntry, field: string, kind: string): string {
  const value = entry[field];
  if (typeof value !== 'string') throw new CatalogError(`${kind} ${field} must be a string`);
  return value;
}

function optionalText(entry: RawEntry, field: string, kind: string): string {
  const value = entry[field];
  if (value === undefined || value === null) return '';
  return requireString(entry, field, kind);
}

function canonicaliseSchema(rawSchema: unknown): JsonSchema {
  if (rawSchema === undefined || rawSchema === null) return {};
  const schema = toJsonValue(rawSchema, 'inputSchema');
  if (!isJsonObject(schema)) throw new CatalogError('tool inputSchema must be an object');
  const canonical = sortKeysRecursively(sortSetLikeArrays(schema));
  return canonical as JsonSchema;
}

// Rejects anything JSON.stringify would silently drop or distort, so two different inputs never hash alike.
function toJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CatalogError(`${path} must not contain a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => toJsonValue(item, `${path}[${String(index)}]`));
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([key, child]) => [key, toJsonValue(child, `${path}.${key}`)] as const);
    return Object.fromEntries(entries);
  }
  throw new CatalogError(`${path} must be JSON`);
}

// Only `required` and `enum` are sets; every other array is positional and keeps its order.
function sortSetLikeArrays(value: JsonValue, parentKey?: string): JsonValue {
  if (Array.isArray(value)) {
    const items = value.map((item) => sortSetLikeArrays(item));
    if (parentKey === 'enum') return deduplicate(items).sort(compareSerialised);
    return parentKey === 'required' ? items.sort(compareSerialised) : items;
  }
  if (!isJsonObject(value)) return value;
  const entries = Object.entries(value).map(([key, child]) => [key, sortSetLikeArrays(child, key)] as const);
  return Object.fromEntries(entries);
}

function deduplicate(items: JsonValue[]): JsonValue[] {
  const uniqueBySerialisation = new Map(items.map((item) => [serialise(item), item]));
  return [...uniqueBySerialisation.values()];
}

// Keys are sorted first so object members that differ only in key order compare equal.
function serialise(value: JsonValue): string {
  return JSON.stringify(sortKeysRecursively(value));
}

function compareSerialised(left: JsonValue, right: JsonValue): number {
  return compareCodeUnits(serialise(left), serialise(right));
}
