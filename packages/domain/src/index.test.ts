import { describe, expect, it } from 'vitest';
import * as domain from './index.js';

describe('@keelson/domain', () => {
  it('exposes a resolvable entry point', () => {
    expect(domain).toBeDefined();
  });
});
