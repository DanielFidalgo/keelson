import { describe, expect, it } from 'vitest';
import { SecretManagerStore, type SecretManagerOperations } from './secret-manager-store.js';

const PROJECT = 'keelson-test';

class InMemorySecretManager implements SecretManagerOperations {
  readonly secrets = new Map<string, string>();
  readonly deleted: string[] = [];

  createSecret(request: { parent?: string | null; secretId?: string | null }): Promise<unknown> {
    this.secrets.set(`${request.parent ?? ''}/secrets/${request.secretId ?? ''}`, '');
    return Promise.resolve([{}]);
  }

  addSecretVersion(request: {
    parent?: string | null;
    payload?: { data?: Uint8Array | string | null } | null;
  }): Promise<[{ name: string }]> {
    const parent = request.parent ?? '';
    this.secrets.set(parent, Buffer.from(request.payload?.data ?? '').toString('utf8'));
    return Promise.resolve([{ name: `${parent}/versions/1` }]);
  }

  accessSecretVersion(request: { name?: string | null }): Promise<[{ payload: { data: Uint8Array } }]> {
    const secret = (request.name ?? '').replace(/\/versions\/.*$/, '');
    return Promise.resolve([{ payload: { data: Buffer.from(this.secrets.get(secret) ?? '') } }]);
  }

  deleteSecret(request: { name?: string | null }): Promise<unknown> {
    this.deleted.push(request.name ?? '');
    return Promise.resolve([{}]);
  }
}

describe('SecretManagerStore', () => {
  it('create stores the value and returns a reference that read resolves back to it', async () => {
    const store = new SecretManagerStore({ secretManagerClient: new InMemorySecretManager(), project: PROJECT });

    const ref = await store.create('monitor-1-bearer', 'tok-secret');

    expect(ref).toBe(`projects/${PROJECT}/secrets/monitor-1-bearer/versions/1`);
    await expect(store.read(ref)).resolves.toBe('tok-secret');
  });

  it('destroy deletes the whole secret, not just the version the reference points at', async () => {
    const client = new InMemorySecretManager();
    const store = new SecretManagerStore({ secretManagerClient: client, project: PROJECT });
    const ref = await store.create('monitor-1-bearer', 'tok-secret');

    await store.destroy(ref);

    expect(client.deleted).toEqual([`projects/${PROJECT}/secrets/monitor-1-bearer`]);
  });

  it('read fails when the version has no payload', async () => {
    const client: SecretManagerOperations = {
      createSecret: () => Promise.resolve([{}]),
      addSecretVersion: () => Promise.resolve([{ name: 'unused' }]),
      accessSecretVersion: () => Promise.resolve([{ payload: null }]),
      deleteSecret: () => Promise.resolve([{}]),
    };

    await expect(new SecretManagerStore({ secretManagerClient: client, project: PROJECT }).read('projects/p/secrets/s/versions/1')).rejects.toThrow(
      'projects/p/secrets/s/versions/1',
    );
  });
});
