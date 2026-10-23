import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSecretStore } from './file-secret-store.js';

let secretsDirectory: string;

beforeEach(async () => {
  secretsDirectory = await mkdtemp(join(tmpdir(), 'keelson-secrets-'));
});

afterEach(async () => {
  await rm(secretsDirectory, { recursive: true, force: true });
});

const storeOver = (directory: string): FileSecretStore => new FileSecretStore({ secretsDirectory: directory });

describe('FileSecretStore', () => {
  it('create stores the value and returns a reference that read resolves back to it', async () => {
    const store = storeOver(secretsDirectory);

    const ref = await store.create('monitor-1-auth-id_1', 'tok-secret');

    await expect(store.read(ref)).resolves.toBe('tok-secret');
  });

  it('a second store over the same directory reads what the first wrote, as the api and worker processes do', async () => {
    const ref = await storeOver(secretsDirectory).create('webhook-1', 'whsec_abc');

    await expect(storeOver(secretsDirectory).read(ref)).resolves.toBe('whsec_abc');
  });

  it('creates the directory when it does not exist yet', async () => {
    const store = storeOver(join(secretsDirectory, 'nested', 'secrets'));

    const ref = await store.create('webhook-1', 'whsec_abc');

    await expect(store.read(ref)).resolves.toBe('whsec_abc');
  });

  it('destroy removes the secret and tolerates one that is already gone', async () => {
    const store = storeOver(secretsDirectory);
    const ref = await store.create('webhook-1', 'whsec_abc');

    await store.destroy(ref);
    await store.destroy(ref);

    await expect(store.read(ref)).rejects.toThrow();
    await expect(readdir(secretsDirectory)).resolves.toEqual([]);
  });

  it('refuses to overwrite an existing secret, like Secret Manager refusing a duplicate id', async () => {
    const store = storeOver(secretsDirectory);
    await store.create('webhook-1', 'first');

    await expect(store.create('webhook-1', 'second')).rejects.toThrow();

    await expect(store.read('webhook-1')).resolves.toBe('first');
  });

  it.each([
    ['a parent directory step', '../outside'],
    ['a bare parent directory', '..'],
    ['a nested path', 'a/b'],
    ['an absolute path', '/etc/passwd'],
    ['a backslash path', 'a\\b'],
    ['a hidden file name', '.hidden'],
    ['an empty name', ''],
  ])('rejects %s on every operation', async (_description, unsafe) => {
    const store = storeOver(secretsDirectory);

    await expect(store.create(unsafe, 'value')).rejects.toThrow(/not a safe secret name/);
    await expect(store.read(unsafe)).rejects.toThrow(/not a safe secret name/);
    await expect(store.destroy(unsafe)).rejects.toThrow(/not a safe secret name/);
  });
});
