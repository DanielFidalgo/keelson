import { DomainValidationError, MAX_CONSECUTIVE_DELIVERY_FAILURES } from '@keelson/domain';
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors.js';
import { UpdateWebhookEndpoint } from './update-webhook-endpoint.js';
import { createHarness, seedEndpoint, TENANT_ID, type Harness } from './test-support.js';

const ENDPOINT_ID = 'whk_1';
const target = { tenantId: TENANT_ID, endpointId: ENDPOINT_ID };

async function seedDisabledEndpoint(harness: Harness): Promise<void> {
  await seedEndpoint(harness, ENDPOINT_ID, 'disabled');
  const seeded = harness.db.webhookEndpoints.records.get(ENDPOINT_ID);
  if (seeded === undefined) throw new Error('endpoint was not seeded');
  await harness.db.webhookEndpoints.save({ ...seeded, consecutiveFailures: MAX_CONSECUTIVE_DELIVERY_FAILURES });
}

describe('UpdateWebhookEndpoint', () => {
  it('changes the url and stores the result', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, ENDPOINT_ID);

    const updated = await new UpdateWebhookEndpoint(harness.deps).execute({ ...target, url: 'https://hooks.example.com/new' });

    expect(updated.url).toBe('https://hooks.example.com/new');
    expect(harness.db.webhookEndpoints.records.get(ENDPOINT_ID)).toEqual(updated);
  });

  it('re-enabling resets the failure count', async () => {
    const harness = createHarness();
    await seedDisabledEndpoint(harness);

    const updated = await new UpdateWebhookEndpoint(harness.deps).execute({ ...target, status: 'active' });

    expect(updated).toMatchObject({ status: 'active', consecutiveFailures: 0 });
  });

  it('rejects an invalid url and keeps the stored endpoint', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, ENDPOINT_ID);
    const before = harness.db.webhookEndpoints.records.get(ENDPOINT_ID);

    const attempt = new UpdateWebhookEndpoint(harness.deps).execute({ ...target, url: 'ftp://x' });

    await expect(attempt).rejects.toBeInstanceOf(DomainValidationError);
    expect(harness.db.webhookEndpoints.records.get(ENDPOINT_ID)).toEqual(before);
  });

  it('treats another tenant\'s endpoint as missing', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, ENDPOINT_ID);

    const attempt = new UpdateWebhookEndpoint(harness.deps).execute({ tenantId: 'ten_other', endpointId: ENDPOINT_ID, status: 'disabled' });

    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
  });
});
