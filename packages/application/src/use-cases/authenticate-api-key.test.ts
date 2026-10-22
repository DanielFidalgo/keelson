import { describe, expect, it } from 'vitest';
import { AuthenticateApiKey } from './authenticate-api-key.js';
import { createHarness } from './test-support.js';

describe('AuthenticateApiKey', () => {
  it('returns null for a key that was never issued', async () => {
    const harness = createHarness();
    expect(await new AuthenticateApiKey(harness.deps).execute('key_unknown')).toBeNull();
  });
});
