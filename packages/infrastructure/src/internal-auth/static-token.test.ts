import { describe, expect, it } from 'vitest';
import type { InternalCaller } from './internal-caller.js';
import { StaticTokenCaller, StaticTokenVerifier } from './static-token.js';

describe('static token authentication', () => {
  const verifier = new StaticTokenVerifier({ internalStaticToken: 'local-secret' });

  it('accepts the configured token', async () => {
    await expect(verifier.verify('Bearer local-secret')).resolves.toBe(true);
  });

  it.each([
    ['a missing header', undefined],
    ['a different token of the same length', 'Bearer local-secreT'],
    ['a shorter token', 'Bearer local'],
    ['a longer token', 'Bearer local-secret-and-more'],
    ['a non-bearer scheme', 'Basic local-secret'],
  ])('rejects %s', async (_name, header) => {
    await expect(verifier.verify(header)).resolves.toBe(false);
  });

  it('the caller presents the token the verifier accepts, whatever the audience', async () => {
    const caller: InternalCaller = new StaticTokenCaller({ internalStaticToken: 'local-secret' });

    await expect(verifier.verify(await caller.authorizationFor('http://worker.test'))).resolves.toBe(true);
  });
});
