import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SecretStore } from '@keelson/application';

export interface FileSecretStoreConfig {
  secretsDirectory: string;
}

// The use cases generate names from ids and the first path separator or dot would let a name leave the directory,
// so anything but this conservative alphabet is refused instead of sanitised.
const SAFE_SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;

// For local and docker runs, where there is no Secret Manager: the api and worker processes share the directory.
export class FileSecretStore implements SecretStore {
  private readonly secretsDirectory: string;

  constructor({ secretsDirectory }: FileSecretStoreConfig) {
    this.secretsDirectory = secretsDirectory;
  }

  async read(ref: string): Promise<string> {
    return readFile(this.pathOf(ref), 'utf8');
  }

  // The reference is the name itself. 'wx' fails on an existing file, as Secret Manager rejects a duplicate id.
  async create(name: string, value: string): Promise<string> {
    const path = this.pathOf(name);
    await mkdir(this.secretsDirectory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
    await writeFile(path, value, { encoding: 'utf8', flag: 'wx', mode: OWNER_ONLY_FILE });
    return name;
  }

  async destroy(ref: string): Promise<void> {
    await rm(this.pathOf(ref), { force: true });
  }

  private pathOf(name: string): string {
    if (!SAFE_SECRET_NAME.test(name)) throw new Error(`"${name}" is not a safe secret name`);
    return join(this.secretsDirectory, name);
  }
}
