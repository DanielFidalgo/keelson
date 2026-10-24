import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '../snapshots/json.js';
import { classifySchemaChange } from './schema-change.js';

const objectWith = (properties: JsonSchema, extra: JsonSchema = {}): JsonSchema => ({
  type: 'object',
  properties,
  ...extra,
});

describe('classifySchemaChange', () => {
  it('reports identical schemas as unchanged', () => {
    const schema = objectWith({ query: { type: 'string' } });
    expect(classifySchemaChange(schema, structuredClone(schema))).toBe('unchanged');
  });

  it.each([
    ['property removed', objectWith({ a: {}, b: {} }), objectWith({ a: {} })],
    ['type changed', objectWith({ a: { type: 'string' } }), objectWith({ a: { type: 'number' } })],
    ['property newly required', objectWith({ a: {} }), objectWith({ a: {} }, { required: ['a'] })],
    ['required property added', objectWith({}), objectWith({ a: {} }, { required: ['a'] })],
    ['required entry dropped', objectWith({ a: {} }, { required: ['a'] }), objectWith({ a: {} })],
    ['enum value removed', { enum: ['a', 'b'] }, { enum: ['a'] }],
    ['enum introduced', { type: 'string' }, { type: 'string', enum: ['a'] }],
    ['unlisted keyword changed', { minimum: 1 }, { minimum: 2 }],
    ['unlisted keyword removed', { minimum: 1 }, {}],
    ['nested property removed', objectWith({ f: objectWith({ a: {}, b: {} }) }), objectWith({ f: objectWith({ a: {} }) })],
    ['items type changed', { type: 'array', items: { type: 'string' } }, { type: 'array', items: { type: 'number' } }],
    ['items removed', { type: 'array', items: { type: 'string' } }, { type: 'array' }],
    ['non-object subschema replaced', { items: true }, { items: false }],
  ] satisfies [string, JsonSchema, JsonSchema][])('classifies %s as breaking', (_label, before, after) => {
    expect(classifySchemaChange(before, after)).toBe('breaking');
  });

  it.each([
    ['optional property added', objectWith({ a: {} }), objectWith({ a: {}, b: {} })],
    ['enum value added', { enum: ['a'] }, { enum: ['a', 'b'] }],
    ['description changed', { description: 'old' }, { description: 'new' }],
    ['title changed', { title: 'old' }, { title: 'new' }],
    ['default changed', { default: 1 }, { default: 2 }],
    ['examples changed', { examples: [1] }, { examples: [1, 2] }],
    ['description added', {}, { description: 'new' }],
    ['nested optional property added', objectWith({ f: objectWith({}) }), objectWith({ f: objectWith({ a: {} }) })],
    [
      'description changed inside items',
      { type: 'array', items: { description: 'old' } },
      { type: 'array', items: { description: 'new' } },
    ],
    ['property named description changed', objectWith({ description: { type: 'string', title: 'a' } }), objectWith({ description: { type: 'string', title: 'b' } })],
  ] satisfies [string, JsonSchema, JsonSchema][])('classifies %s as compatible', (_label, before, after) => {
    expect(classifySchemaChange(before, after)).toBe('compatible');
  });

  it('lets one breaking difference outweigh compatible ones', () => {
    const before = objectWith({ a: { type: 'string' } });
    const after = objectWith({ a: { type: 'number' }, b: {} }, { description: 'new' });
    expect(classifySchemaChange(before, after)).toBe('breaking');
  });

  it('treats a property named like a keyword as a property, not a keyword', () => {
    const before = objectWith({ default: { type: 'string' } });
    const after = objectWith({});
    expect(classifySchemaChange(before, after)).toBe('breaking');
  });
});
