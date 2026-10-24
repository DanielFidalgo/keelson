import { describe, expect, it } from 'vitest';
import { canonicalise } from './catalog.js';
import { CatalogError } from '../shared/errors.js';
import { toolA, toolB, withTool, withTools } from '../test-support.js';

describe('canonicalise', () => {
  it('rejects two tools with the same name', () => {
    expect(() => canonicalise(withTools([toolA, toolA]))).toThrow(CatalogError);
  });

  it('rejects two resources with the same uri', () => {
    const resource = { uri: 'file:///a', name: 'a' };
    expect(() => canonicalise({ tools: [], prompts: [], resources: [resource, resource] })).toThrow(CatalogError);
  });

  it('rejects a tool without a string name', () => {
    expect(() => canonicalise(withTool({ description: 'nameless' }))).toThrow(CatalogError);
    expect(() => canonicalise(withTool({ name: 7 }))).toThrow(CatalogError);
  });

  it('rejects a resource without a string uri', () => {
    expect(() => canonicalise({ tools: [], prompts: [], resources: [{ name: 'no uri' }] })).toThrow(CatalogError);
  });

  it('rejects an entry that is not an object', () => {
    expect(() => canonicalise(withTools(['alpha']))).toThrow(CatalogError);
  });

  it('rejects an input schema that is not JSON', () => {
    expect(() => canonicalise(withTool({ name: 'x', inputSchema: { limit: undefined } }))).toThrow(CatalogError);
  });

  it('defaults a missing description to the empty string', () => {
    const { tools, prompts } = canonicalise({ tools: [{ name: 'x' }], prompts: [{ name: 'p' }], resources: [] });
    expect(tools[0]?.description).toBe('');
    expect(prompts[0]?.description).toBe('');
  });

  it('keeps only the canonical fields', () => {
    const { tools } = canonicalise(withTool({ ...toolA, annotations: { x: 1 }, _meta: {} }));
    expect(Object.keys(tools[0] ?? {})).toEqual(['name', 'description', 'inputSchema']);
  });

  it('sorts tools by name and resources by uri', () => {
    const resources = [{ uri: 'b://2', name: 'two' }, { uri: 'a://1', name: 'one' }];
    const catalog = canonicalise({ tools: [toolB, toolA], prompts: [], resources });
    expect(catalog.tools.map((tool) => tool.name)).toEqual(['alpha', 'beta']);
    expect(catalog.resources.map((resource) => resource.uri)).toEqual(['a://1', 'b://2']);
  });

  it('sorts schema keys recursively and the required array', () => {
    const { tools } = canonicalise(withTool(toolA));
    const schema = tools[0]?.inputSchema;
    expect(Object.keys(schema ?? {})).toEqual(['properties', 'required', 'type']);
    expect(schema?.['required']).toEqual(['limit', 'query']);
  });

  it('sorts an enum that holds objects by their canonical form', () => {
    const inputSchema = { enum: [{ b: 1 }, { a: 2 }] };
    const { tools } = canonicalise(withTool({ name: 'x', inputSchema }));
    expect(tools[0]?.inputSchema['enum']).toEqual([{ a: 2 }, { b: 1 }]);
  });

  it('removes duplicate enum members, including objects that differ only in key order', () => {
    const inputSchema = { enum: ['a', 'a', 'b', { x: 1, y: 2 }, { y: 2, x: 1 }] };
    const { tools } = canonicalise(withTool({ name: 'x', inputSchema }));
    expect(tools[0]?.inputSchema['enum']).toEqual(['a', 'b', { x: 1, y: 2 }]);
  });

  it('drops the resource name, since a resource is identified by its uri', () => {
    const { resources } = canonicalise({ tools: [], prompts: [], resources: [{ uri: 'file:///a', name: 'a' }] });
    expect(resources).toEqual([{ uri: 'file:///a' }]);
  });

  it('keeps the order of arrays that are not sets', () => {
    const { tools } = canonicalise(withTool({ name: 'x', inputSchema: { examples: ['z', 'a'] } }));
    expect(tools[0]?.inputSchema['examples']).toEqual(['z', 'a']);
  });
});
