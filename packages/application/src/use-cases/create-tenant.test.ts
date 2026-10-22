import { describe, expect, it } from 'vitest';
import { AuthenticateApiKey } from './authenticate-api-key.js';
import { CreateTenant } from './create-tenant.js';
import { createHarness, NOW } from './test-support.js';

describe('CreateTenant', () => {
  it('returns a key once and stores only its hash; authenticating with it returns the tenant', async () => {
    const harness = createHarness();

    const { tenantId, apiKey } = await new CreateTenant(harness.deps).execute({ name: 'Acme' });

    const storedKeys = [...harness.db.apiKeys.records.values()];
    expect(storedKeys).toHaveLength(1);
    expect(storedKeys[0]).toMatchObject({ tenantId, keyHash: harness.credentials.hashApiKey(apiKey), createdAt: NOW });
    expect(Object.values(storedKeys[0] ?? {})).not.toContain(apiKey);
    expect(harness.db.tenants.records.get(tenantId)).toEqual({ id: tenantId, name: 'Acme' });
    expect(await new AuthenticateApiKey(harness.deps).execute(apiKey)).toBe(tenantId);
  });

  it('gives each tenant its own key', async () => {
    const harness = createHarness();
    const create = new CreateTenant(harness.deps);

    const first = await create.execute({ name: 'Acme' });
    const second = await create.execute({ name: 'Globex' });

    expect(second.tenantId).not.toBe(first.tenantId);
    expect(second.apiKey).not.toBe(first.apiKey);
    expect(await new AuthenticateApiKey(harness.deps).execute(second.apiKey)).toBe(second.tenantId);
  });
});
