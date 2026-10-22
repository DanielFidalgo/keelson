import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors.js';
import { DeleteWebhookEndpoint } from './delete-webhook-endpoint.js';
import { createHarness, seedEndpoint, seedStandardEndpoint, TENANT_ID } from './test-support.js';

describe('DeleteWebhookEndpoint', () => {
  it('removes the endpoint and destroys its signing secret', async () => {
    const harness = createHarness();
    await seedStandardEndpoint(harness, 'whk_1', 'whsec_1');

    await new DeleteWebhookEndpoint(harness.deps).execute({ tenantId: TENANT_ID, endpointId: 'whk_1' });

    expect(harness.db.webhookEndpoints.records.size).toBe(0);
    expect(harness.secrets.refs()).toEqual([]);
  });

  it('removes an endpoint that has no secret', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, 'whk_1');

    await new DeleteWebhookEndpoint(harness.deps).execute({ tenantId: TENANT_ID, endpointId: 'whk_1' });

    expect(harness.db.webhookEndpoints.records.size).toBe(0);
  });

  it('treats another tenant\'s endpoint as missing and keeps it', async () => {
    const harness = createHarness();
    await seedStandardEndpoint(harness, 'whk_1', 'whsec_1');

    const attempt = new DeleteWebhookEndpoint(harness.deps).execute({ tenantId: 'ten_other', endpointId: 'whk_1' });

    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
    expect(harness.db.webhookEndpoints.records.size).toBe(1);
    expect(harness.secrets.refs()).toHaveLength(1);
  });
});
