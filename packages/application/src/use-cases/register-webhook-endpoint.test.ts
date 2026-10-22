import { DomainValidationError } from '@keelson/domain';
import { describe, expect, it } from 'vitest';
import { RegisterWebhookEndpoint } from './register-webhook-endpoint.js';
import { createHarness, TENANT_ID } from './test-support.js';

const URL = 'https://hooks.example.com/keelson';

describe('RegisterWebhookEndpoint', () => {
  it('a standard endpoint gets a generated signing secret that is stored and returned once', async () => {
    const harness = createHarness();

    const { endpoint, signingSecret } = await new RegisterWebhookEndpoint(harness.deps).execute({
      tenantId: TENANT_ID,
      url: URL,
      format: 'standard',
    });

    expect(signingSecret).not.toBeNull();
    expect(endpoint.secretRef).not.toBeNull();
    expect(await harness.secrets.read(endpoint.secretRef ?? '')).toBe(signingSecret);
    expect(harness.db.webhookEndpoints.records.get(endpoint.id)).toEqual(endpoint);
  });

  it('a slack endpoint has no signing secret', async () => {
    const harness = createHarness();

    const { endpoint, signingSecret } = await new RegisterWebhookEndpoint(harness.deps).execute({
      tenantId: TENANT_ID,
      url: URL,
      format: 'slack',
    });

    expect(signingSecret).toBeNull();
    expect(endpoint).toMatchObject({ secretRef: null, status: 'active', consecutiveFailures: 0 });
    expect(harness.secrets.refs()).toEqual([]);
  });

  it('an invalid standard endpoint is rejected and leaves no secret behind', async () => {
    const harness = createHarness();

    const attempt = new RegisterWebhookEndpoint(harness.deps).execute({
      tenantId: TENANT_ID,
      url: 'not a url',
      format: 'standard',
    });

    await expect(attempt).rejects.toBeInstanceOf(DomainValidationError);
    expect(harness.secrets.refs()).toEqual([]);
    expect(harness.db.webhookEndpoints.records.size).toBe(0);
  });
});
