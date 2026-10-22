export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonSchema = { [key: string]: JsonValue };

export function isJsonObject(value: JsonValue): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Code-unit order, not locale order, so the result never depends on the host's ICU data.
export function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function sortKeysRecursively(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeysRecursively);
  if (!isJsonObject(value)) return value;
  const sortedEntries = Object.entries(value)
    .sort(([leftKey], [rightKey]) => compareCodeUnits(leftKey, rightKey))
    .map(([key, child]) => [key, sortKeysRecursively(child)] as const);
  return Object.fromEntries(sortedEntries);
}
