import { describe, expect, it } from 'vitest';
import { RandomCredentialFactory } from './credential-factory.js';

const factory = new RandomCredentialFactory();

describe('RandomCredentialFactory', () => {
  it('issues a signing secret of whsec_ followed by 24 random bytes in base64', () => {
    const secret = factory.signingSecret();

    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    expect(factory.signingSecret()).not.toBe(secret);
  });

  it('issues an API key of kls_ followed by 32 random bytes in base64url', () => {
    const { plainText } = factory.apiKey();

    expect(plainText).toMatch(/^kls_[A-Za-z0-9_-]{43}$/);
  });

  it('api keys hash deterministically and differ per issue', () => {
    const first = factory.apiKey();
    const second = factory.apiKey();

    expect(factory.hashApiKey(first.plainText)).toBe(first.hash);
    expect(factory.hashApiKey(first.plainText)).toBe(first.hash);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.plainText).not.toBe(first.plainText);
    expect(second.hash).not.toBe(first.hash);
  });
});
