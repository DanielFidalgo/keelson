import type { SecretStore } from '../ports/index.js';

export class FakeSecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  refs(): string[] {
    return [...this.values.keys()];
  }

  read(ref: string): Promise<string> {
    const value = this.values.get(ref);
    if (value === undefined) return Promise.reject(new Error(`unknown secret ref: ${ref}`));
    return Promise.resolve(value);
  }

  create(name: string, value: string): Promise<string> {
    const ref = `secret://${name}`;
    this.values.set(ref, value);
    return Promise.resolve(ref);
  }

  destroy(ref: string): Promise<void> {
    this.values.delete(ref);
    return Promise.resolve();
  }
}
