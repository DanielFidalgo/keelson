import { publicEncrypt, constants, type KeyObject } from 'node:crypto';

export interface ApiKeyHandoffContext {
  recipientKey: KeyObject | null;
  stdoutIsTerminal: boolean;
}

// Renders the line that tells the operator their API key; built from the key once the tenant exists.
export type ApiKeyHandoff = (apiKey: string) => string;

export function sealApiKey(apiKey: string, recipientKey: KeyObject): string {
  const sealed = publicEncrypt(
    { key: recipientKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(apiKey, 'utf8'),
  );
  return sealed.toString('base64');
}

// Decided before the tenant is created so a refusal leaves nothing behind. Without a terminal, stdout is captured by
// Cloud Logging, which keeps the plaintext key readable by everyone with log access.
export function chooseApiKeyHandoff({ recipientKey, stdoutIsTerminal }: ApiKeyHandoffContext): ApiKeyHandoff {
  if (recipientKey !== null) {
    return (apiKey) => `sealed api key (decrypt with your private key, shown once): ${sealApiKey(apiKey, recipientKey)}`;
  }
  if (stdoutIsTerminal) {
    return (apiKey) => `api key (shown once): ${apiKey}`;
  }
  throw new Error(
    'Refusing to print the api key: stdout is not a terminal, so the key would be written to the logs. Pass --recipient-key <base64 DER public key> to receive it sealed.',
  );
}
