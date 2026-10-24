export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface CredentialFactory {
  signingSecret(): string;
  apiKey(): { plainText: string; hash: string };
  hashApiKey(plainText: string): string;
}
