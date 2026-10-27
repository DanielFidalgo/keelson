import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseCreateTenantArguments } from './arguments.js';

function encodePublicKey(modulusLength: number): string {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength });
  return publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}

describe('parseCreateTenantArguments', () => {
  it('reads --name', () => {
    expect(parseCreateTenantArguments(['--name', 'Acme']).name).toBe('Acme');
  });

  it('accepts the --name=value form and trims the value', () => {
    expect(parseCreateTenantArguments(['--name=  Acme  ']).name).toBe('Acme');
  });

  it.each([
    ['no arguments', []],
    ['an empty name', ['--name', '']],
    ['a blank name', ['--name', '   ']],
    ['a flag without a value', ['--name']],
  ])('rejects %s', (_description, argv) => {
    expect(() => parseCreateTenantArguments(argv)).toThrow('--name');
  });

  it('rejects an option it does not know instead of ignoring a typo', () => {
    expect(() => parseCreateTenantArguments(['--name', 'Acme', '--nmae', 'x'])).toThrow();
  });

  it('has no recipient key when --recipient-key is absent', () => {
    expect(parseCreateTenantArguments(['--name', 'Acme']).recipientKey).toBeNull();
  });

  it('reads --recipient-key as an RSA public key', () => {
    const { recipientKey } = parseCreateTenantArguments(['--name', 'Acme', `--recipient-key=${encodePublicKey(2048)}`]);

    expect((recipientKey as KeyObject).asymmetricKeyType).toBe('rsa');
  });

  it('rejects a recipient key that is not a public key', () => {
    expect(() => parseCreateTenantArguments(['--name', 'Acme', '--recipient-key', 'not-a-key'])).toThrow(
      '--recipient-key',
    );
  });

  it('rejects an RSA recipient key below 2048 bits', () => {
    expect(() =>
      parseCreateTenantArguments(['--name', 'Acme', `--recipient-key=${encodePublicKey(1024)}`]),
    ).toThrow('2048');
  });
});
