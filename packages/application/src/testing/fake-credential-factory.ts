import type { CredentialFactory } from '../ports/index.js';

export class FakeCredentialFactory implements CredentialFactory {
  private counter = 0;

  signingSecret(): string {
    return `whsec_${this.nextNumber()}`;
  }

  apiKey(): { plainText: string; hash: string } {
    const plainText = `key_${this.nextNumber()}`;
    return { plainText, hash: this.hashApiKey(plainText) };
  }

  hashApiKey(plainText: string): string {
    return `hash_of_${plainText}`;
  }

  private nextNumber(): string {
    this.counter += 1;
    return String(this.counter);
  }
}
