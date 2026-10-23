import { createHash, timingSafeEqual } from 'node:crypto';
import { bearerTokenFrom, toBearerHeader } from './bearer.js';
import type { InternalCaller } from './internal-caller.js';
import type { InternalRequestVerifier } from './internal-request-verifier.js';

export interface StaticTokenConfig {
  internalStaticToken: string;
}

// Hashing first gives timingSafeEqual equal-length inputs, so the comparison leaks neither content nor length.
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

// For local runs and e2e only: it replaces Google OIDC where there is no metadata server to mint tokens.
export class StaticTokenVerifier implements InternalRequestVerifier {
  private readonly expectedDigest: Buffer;

  constructor({ internalStaticToken }: StaticTokenConfig) {
    this.expectedDigest = digest(internalStaticToken);
  }

  verify(authorizationHeader: string | undefined): Promise<boolean> {
    const presented = bearerTokenFrom(authorizationHeader);
    return Promise.resolve(presented !== null && timingSafeEqual(digest(presented), this.expectedDigest));
  }
}

export class StaticTokenCaller implements InternalCaller {
  private readonly token: string;

  constructor({ internalStaticToken }: StaticTokenConfig) {
    this.token = internalStaticToken;
  }

  authorizationFor(): Promise<string> {
    return Promise.resolve(toBearerHeader(this.token));
  }
}
