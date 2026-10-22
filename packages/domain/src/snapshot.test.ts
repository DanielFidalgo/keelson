import { describe, expect, it } from 'vitest';
import { canonicalJson, createSnapshot } from './snapshot.js';
import { reorderKeys, toolA, toolB, withTool, withTools } from './test-support.js';

describe('createSnapshot', () => {
  it('hashes the same catalog identically regardless of list and key order', () => {
    const a = createSnapshot(withTools([toolA, toolB]));
    const b = createSnapshot(withTools([reorderKeys(toolB), toolA]));
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores fields outside the canonical form', () => {
    const noisy = withTool({ ...toolA, annotations: { x: 1 }, _meta: {} });
    expect(createSnapshot(noisy).hash).toBe(createSnapshot(withTool(toolA)).hash);
  });

  it('treats the order of `required` and primitive `enum` arrays as irrelevant', () => {
    const schema = (required: string[], values: string[]) => ({
      name: 'x',
      inputSchema: { required, properties: { mode: { enum: values } } },
    });
    const first = createSnapshot(withTool(schema(['a', 'b'], ['fast', 'slow'])));
    const second = createSnapshot(withTool(schema(['b', 'a'], ['slow', 'fast'])));
    expect(first.hash).toBe(second.hash);
  });

  it('changes the hash when a description changes by one character', () => {
    const changed = withTool({ ...toolA, description: 'First toop' });
    expect(createSnapshot(changed).hash).not.toBe(createSnapshot(withTool(toolA)).hash);
  });

  it('changes the hash when the order of a positional array changes', () => {
    const schema = (examples: string[]) => ({ name: 'x', inputSchema: { examples } });
    const first = createSnapshot(withTool(schema(['a', 'b'])));
    const second = createSnapshot(withTool(schema(['b', 'a'])));
    expect(first.hash).not.toBe(second.hash);
  });
});

describe('canonicalJson', () => {
  it('serialises without whitespace and with sorted keys', () => {
    expect(canonicalJson({ b: [1, { d: null, c: true }], a: 'x' })).toBe('{"a":"x","b":[1,{"c":true,"d":null}]}');
  });
});
