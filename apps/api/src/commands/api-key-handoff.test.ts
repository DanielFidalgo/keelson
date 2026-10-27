import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chooseApiKeyHandoff, sealApiKey } from './api-key-handoff.js';

const API_KEY = 'klsn_plaintext_api_key';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
// The README's decrypt command takes whatever follows this label, so the line format is part of the contract.
const SEALED_LINE_PATTERN = /^sealed api key \(decrypt with your private key, shown once\): (\S+)$/;

function openSealedLine(printed: string): string {
  const sealed = SEALED_LINE_PATTERN.exec(printed)?.[1] ?? '';
  return privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(sealed, 'base64'),
  ).toString('utf8');
}

describe('sealApiKey', () => {
  it('can be decrypted with the matching private key using OAEP and sha256', () => {
    const sealed = sealApiKey(API_KEY, publicKey);

    const opened = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(sealed, 'base64'),
    );

    expect(opened.toString('utf8')).toBe(API_KEY);
  });
});

describe('chooseApiKeyHandoff', () => {
  it('prints only the sealed key when a recipient key is given', () => {
    const printed = chooseApiKeyHandoff({ recipientKey: publicKey, stdoutIsTerminal: false })(API_KEY);

    expect(printed).not.toContain(API_KEY);
  });

  it('prints a sealed value that the matching private key opens to the api key', () => {
    const printed = chooseApiKeyHandoff({ recipientKey: publicKey, stdoutIsTerminal: false })(API_KEY);

    expect(openSealedLine(printed)).toBe(API_KEY);
  });

  it('seals even when stdout is a terminal', () => {
    const printed = chooseApiKeyHandoff({ recipientKey: publicKey, stdoutIsTerminal: true })(API_KEY);

    expect(printed).not.toContain(API_KEY);
  });

  it('prints the key when there is no recipient key and stdout is a terminal', () => {
    const printed = chooseApiKeyHandoff({ recipientKey: null, stdoutIsTerminal: true })(API_KEY);

    expect(printed).toContain(API_KEY);
  });

  it('refuses without a recipient key when stdout is not a terminal, naming the option to pass', () => {
    expect(() => chooseApiKeyHandoff({ recipientKey: null, stdoutIsTerminal: false })).toThrow('--recipient-key');
  });
});
