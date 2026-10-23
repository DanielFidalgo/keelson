import { createHash, randomBytes } from 'node:crypto';
import type { CredentialFactory } from '@keelson/application';

const SIGNING_SECRET_PREFIX = 'whsec_';
const SIGNING_SECRET_BYTES = 24;
const API_KEY_PREFIX = 'kls_';
const API_KEY_BYTES = 32;

export class RandomCredentialFactory implements CredentialFactory {
  // The whsec_ prefix with a base64 body is the format the Standard Webhooks libraries expect from a signing secret.
  signingSecret(): string {
    return `${SIGNING_SECRET_PREFIX}${randomBytes(SIGNING_SECRET_BYTES).toString('base64')}`;
  }

  apiKey(): { plainText: string; hash: string } {
    const plainText = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('base64url')}`;
    return { plainText, hash: this.hashApiKey(plainText) };
  }

  // Keys carry 256 bits of entropy, so a fast unsalted hash is enough and keeps lookup by hash possible.
  hashApiKey(plainText: string): string {
    return createHash('sha256').update(plainText).digest('hex');
  }
}
