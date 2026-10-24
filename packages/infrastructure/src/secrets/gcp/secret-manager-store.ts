import type { SecretStore } from '@keelson/application';
import type { SecretManagerServiceClient } from '@google-cloud/secret-manager';

type AddSecretVersionRequest = Parameters<SecretManagerServiceClient['addSecretVersion']>[0];

// The operations the store uses, so a test double does not have to implement the whole generated client.
export interface SecretManagerOperations {
  createSecret(request: { parent: string; secretId: string; secret: { replication: { automatic: object } } }): Promise<unknown>;
  addSecretVersion(request: NonNullable<AddSecretVersionRequest>): Promise<readonly [{ name?: string | null }, ...unknown[]]>;
  accessSecretVersion(request: {
    name: string;
  }): Promise<readonly [{ payload?: { data?: Uint8Array | string | null } | null }, ...unknown[]]>;
  deleteSecret(request: { name: string }): Promise<unknown>;
}

export interface SecretManagerStoreConfig {
  secretManagerClient: SecretManagerOperations;
  project: string;
}

const VERSION_SEGMENT = '/versions/';

export class SecretManagerStore implements SecretStore {
  private readonly config: SecretManagerStoreConfig;

  constructor(config: SecretManagerStoreConfig) {
    this.config = config;
  }

  async read(ref: string): Promise<string> {
    const [version] = await this.config.secretManagerClient.accessSecretVersion({ name: ref });
    const data = version.payload?.data;
    if (data === undefined || data === null) throw new Error(`secret version ${ref} has no payload`);
    return Buffer.from(data).toString('utf8');
  }

  async create(name: string, value: string): Promise<string> {
    const { secretManagerClient, project } = this.config;
    const parent = `projects/${project}`;
    await secretManagerClient.createSecret({ parent, secretId: name, secret: { replication: { automatic: {} } } });
    const [version] = await secretManagerClient.addSecretVersion({
      parent: `${parent}/secrets/${name}`,
      payload: { data: Buffer.from(value, 'utf8') },
    });
    if (version.name === undefined || version.name === null) throw new Error(`secret ${name} was created without a version`);
    return version.name;
  }

  // Deleting only the version would leave an empty secret behind, so the reference is widened to its parent secret.
  async destroy(ref: string): Promise<void> {
    const versionStart = ref.indexOf(VERSION_SEGMENT);
    const secretName = versionStart === -1 ? ref : ref.slice(0, versionStart);
    await this.config.secretManagerClient.deleteSecret({ name: secretName });
  }
}
