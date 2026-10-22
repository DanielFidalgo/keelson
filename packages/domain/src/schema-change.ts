import { isJsonObject, type JsonSchema, type JsonValue } from './json.js';
import { canonicalJson } from './snapshot.js';

export type SchemaChangeClass = 'unchanged' | 'compatible' | 'breaking';

type Keyword = JsonValue | undefined;

const SEVERITY_ORDER: readonly SchemaChangeClass[] = ['unchanged', 'compatible', 'breaking'];

// Keywords that only document or suggest values and never change what the tool accepts.
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set(['description', 'title', 'default', 'examples']);

// Anything not explicitly recognised as safe is breaking, so an unfamiliar keyword can never hide a rug pull.
export function classifySchemaChange(before: JsonSchema, after: JsonSchema): SchemaChangeClass {
  const keywords = new Set([...Object.keys(before), ...Object.keys(after)]);
  return worstOf([...keywords].map((keyword) => classifyKeyword(keyword, before[keyword], after[keyword])));
}

function classifyKeyword(keyword: string, before: Keyword, after: Keyword): SchemaChangeClass {
  if (sameJson(before, after)) return 'unchanged';
  if (ANNOTATION_KEYWORDS.has(keyword)) return 'compatible';
  if (keyword === 'properties') return classifyProperties(before, after);
  if (keyword === 'items') return classifySubschema(before, after);
  if (keyword === 'enum') return classifyEnum(before, after);
  return 'breaking';
}

function classifyProperties(before: Keyword, after: Keyword): SchemaChangeClass {
  if (before === undefined || after === undefined || !isJsonObject(before) || !isJsonObject(after)) return 'breaking';
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return worstOf([...names].map((name) => classifyProperty(before[name], after[name])));
}

// A property that is new and also required is caught by the `required` keyword, not here.
function classifyProperty(before: Keyword, after: Keyword): SchemaChangeClass {
  if (before === undefined) return 'compatible';
  if (after === undefined) return 'breaking';
  return classifySubschema(before, after);
}

function classifySubschema(before: Keyword, after: Keyword): SchemaChangeClass {
  if (before === undefined || after === undefined || !isJsonObject(before) || !isJsonObject(after)) {
    return sameJson(before, after) ? 'unchanged' : 'breaking';
  }
  return classifySchemaChange(before, after);
}

function classifyEnum(before: Keyword, after: Keyword): SchemaChangeClass {
  if (!Array.isArray(before) || !Array.isArray(after)) return 'breaking';
  const afterValues = new Set(after.map(canonicalJson));
  const beforeValues = new Set(before.map(canonicalJson));
  if ([...beforeValues].some((value) => !afterValues.has(value))) return 'breaking';
  return afterValues.size > beforeValues.size ? 'compatible' : 'unchanged';
}

function sameJson(before: Keyword, after: Keyword): boolean {
  if (before === undefined || after === undefined) return before === after;
  return canonicalJson(before) === canonicalJson(after);
}

function worstOf(classes: readonly SchemaChangeClass[]): SchemaChangeClass {
  return classes.reduce<SchemaChangeClass>(
    (worst, current) => (SEVERITY_ORDER.indexOf(current) > SEVERITY_ORDER.indexOf(worst) ? current : worst),
    'unchanged',
  );
}
