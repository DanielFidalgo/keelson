import { createPublicKey, type KeyObject } from 'node:crypto';
import { parseArgs } from 'node:util';

const USAGE = 'usage: create-tenant --name <name> [--recipient-key <base64 DER public key>]';
const MINIMUM_RECIPIENT_MODULUS_BITS = 2048;

export interface CreateTenantArguments {
  name: string;
  recipientKey: KeyObject | null;
}

// parseArgs rejects options it does not know, so a mistyped flag fails here rather than being silently ignored.
export function parseCreateTenantArguments(argv: string[]): CreateTenantArguments {
  const { values } = parseArgs({
    args: argv,
    options: { name: { type: 'string' }, 'recipient-key': { type: 'string' } },
    strict: true,
  });
  const name = values.name?.trim() ?? '';
  if (name === '') throw new Error(`--name must not be empty. ${USAGE}`);
  const recipientKey = values['recipient-key'] === undefined ? null : parseRecipientKey(values['recipient-key']);
  return { name, recipientKey };
}

// Validated here so a bad key fails before the tenant exists: the API key cannot be recovered if sealing fails later.
function parseRecipientKey(base64Der: string): KeyObject {
  const invalid = new Error(
    `--recipient-key must be an RSA public key of at least ${String(MINIMUM_RECIPIENT_MODULUS_BITS)} bits, as base64 of its DER SubjectPublicKeyInfo. ${USAGE}`,
  );
  let key: KeyObject;
  try {
    key = createPublicKey({ key: Buffer.from(base64Der.trim(), 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw invalid;
  }
  const modulusLength = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (key.asymmetricKeyType !== 'rsa' || modulusLength < MINIMUM_RECIPIENT_MODULUS_BITS) throw invalid;
  return key;
}
