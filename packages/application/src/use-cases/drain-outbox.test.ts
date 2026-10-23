import { MAX_CONSECUTIVE_DELIVERY_FAILURES } from '@keelson/domain';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '../testing/index.js';
import { DRAIN_BATCH_LIMIT, DrainOutbox, MAX_FAILURE_REASON_LENGTH } from './drain-outbox.js';
import {
  createHarness,
  NOW,
  SAMPLE_ALERT,
  seedEndpoint,
  seedOutboxMessage,
  seedStandardEndpoint,
  type Harness,
} from './test-support.js';

const ONE_MINUTE_MS = 60_000;
const TWO_HOURS_MS = 2 * 60 * ONE_MINUTE_MS;

const message = (harness: Harness, id: string) => harness.db.outbox.messages().find((candidate) => candidate.id === id);
const endpoint = (harness: Harness, id: string) => harness.db.webhookEndpoints.records.get(id);

async function failEndpointNineTimes(harness: Harness, id: string): Promise<void> {
  const current = endpoint(harness, id);
  if (current === undefined) throw new Error(`endpoint ${id} was not seeded`);
  await harness.db.webhookEndpoints.save({ ...current, consecutiveFailures: MAX_CONSECUTIVE_DELIVERY_FAILURES - 1 });
}

describe('DrainOutbox', () => {
  it('drain sends due messages, marks them sent and resets the endpoint failure count', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, 'whk_1');
    const seeded = endpoint(harness, 'whk_1');
    if (seeded === undefined) throw new Error('endpoint was not seeded');
    await harness.db.webhookEndpoints.save({ ...seeded, consecutiveFailures: 3 });
    await seedOutboxMessage(harness, 'out_1', 'whk_1');

    const result = await new DrainOutbox(harness.deps).execute();

    expect(result).toEqual({ sent: 1, failed: 0, failures: [] });
    expect(message(harness, 'out_1')?.sentAt).toEqual(NOW);
    expect(endpoint(harness, 'whk_1')?.consecutiveFailures).toBe(0);
    expect(harness.channels.slack.deliveries).toEqual([
      {
        url: 'https://hooks.example.com/whk_1',
        signingSecret: null,
        alert: SAMPLE_ALERT,
        messageId: 'msg_out_1',
        timestamp: NOW,
      },
    ]);
  });

  it('a failed delivery stays pending with attempts + 1 and the backed-off nextAttemptAt', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, 'whk_1');
    await seedOutboxMessage(harness, 'out_1', 'whk_1');
    harness.channels.slack.respondWith({ delivered: false, reason: 'http 500' });

    const result = await new DrainOutbox(harness.deps).execute();

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(message(harness, 'out_1')).toMatchObject({
      sentAt: null,
      attempts: 1,
      nextAttemptAt: new Date(NOW.getTime() + ONE_MINUTE_MS),
    });
    expect(endpoint(harness, 'whk_1')?.consecutiveFailures).toBe(1);
  });

  it('keeps the reason of a failed delivery on the message', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, 'whk_1');
    await seedOutboxMessage(harness, 'out_1', 'whk_1');
    harness.channels.slack.respondWith({ delivered: false, reason: 'HTTP 500' });

    await new DrainOutbox(harness.deps).execute();

    expect(message(harness, 'out_1')?.lastError).toBe('HTTP 500');
  });

  it('bounds a very long failure reason before it is stored', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, 'whk_1');
    await seedOutboxMessage(harness, 'out_1', 'whk_1');
    harness.channels.slack.respondWith({ delivered: false, reason: 'x'.repeat(MAX_FAILURE_REASON_LENGTH + 100) });

    const result = await new DrainOutbox(harness.deps).execute();

    expect(message(harness, 'out_1')?.lastError).toHaveLength(MAX_FAILURE_REASON_LENGTH);
    expect(result.failures[0]?.reason).toHaveLength(MAX_FAILURE_REASON_LENGTH);
  });

  it('reports each failed delivery with the attempt count and the reason', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, 'whk_1');
    await seedOutboxMessage(harness, 'out_1', 'whk_1');
    harness.channels.slack.respondWith({ delivered: false, reason: 'HTTP 500' });

    const result = await new DrainOutbox(harness.deps).execute();

    expect(result.failures).toEqual([
      { messageId: 'msg_out_1', incidentId: 'inc_1', endpointId: 'whk_1', attempts: 1, reason: 'HTTP 500', endpointDisabled: false },
    ]);
  });

  it('flags the failure that disabled the endpoint', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, 'whk_1');
    await failEndpointNineTimes(harness, 'whk_1');
    await seedOutboxMessage(harness, 'out_1', 'whk_1');
    harness.channels.slack.respondWith({ delivered: false, reason: 'HTTP 410' });

    const result = await new DrainOutbox(harness.deps).execute();

    expect(result.failures.map((failure) => failure.endpointDisabled)).toEqual([true]);
  });

  it('a channel that throws counts as a failed delivery instead of crashing the drain', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, 'whk_1');
    await seedOutboxMessage(harness, 'out_1', 'whk_1');
    await seedOutboxMessage(harness, 'out_2', 'whk_1');
    harness.channels.slack.respondWith(new Error('connection reset'));

    const result = await new DrainOutbox(harness.deps).execute();

    expect(result).toMatchObject({ sent: 1, failed: 1 });
    expect(message(harness, 'out_1')).toMatchObject({ sentAt: null, attempts: 1, lastError: 'connection reset' });
    expect(message(harness, 'out_2')?.sentAt).toEqual(NOW);
  });

  it('the tenth consecutive failure disables the endpoint; its messages are no longer claimed', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, 'whk_1');
    await failEndpointNineTimes(harness, 'whk_1');
    await seedOutboxMessage(harness, 'out_1', 'whk_1');
    await seedOutboxMessage(harness, 'out_2', 'whk_1');
    harness.channels.slack.respondWith({ delivered: false, reason: 'http 500' });

    const first = await new DrainOutbox(harness.deps).execute();
    const later = new FixedClock(new Date(NOW.getTime() + TWO_HOURS_MS));
    const second = await new DrainOutbox({ ...harness.deps, clock: later }).execute();

    expect(endpoint(harness, 'whk_1')?.status).toBe('disabled');
    expect(first).toMatchObject({ sent: 0, failed: 1 });
    expect(second).toEqual({ sent: 0, failed: 0, failures: [] });
    expect(harness.channels.slack.deliveries).toHaveLength(1);
    expect(message(harness, 'out_2')?.sentAt).toBeNull();
  });

  it('a standard endpoint receives its signing secret in the delivery; a slack endpoint receives null', async () => {
    const harness = createHarness();
    await seedStandardEndpoint(harness, 'whk_std', 'whsec_secret');
    await seedEndpoint(harness, 'whk_slack');
    await seedOutboxMessage(harness, 'out_std', 'whk_std');
    await seedOutboxMessage(harness, 'out_slack', 'whk_slack');

    await new DrainOutbox(harness.deps).execute();

    expect(harness.channels.standard.deliveries.map((delivery) => delivery.signingSecret)).toEqual(['whsec_secret']);
    expect(harness.channels.slack.deliveries.map((delivery) => delivery.signingSecret)).toEqual([null]);
  });

  it('does not deliver a message twice', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, 'whk_1');
    await seedOutboxMessage(harness, 'out_1', 'whk_1');
    const drain = new DrainOutbox(harness.deps);

    await drain.execute();
    const second = await drain.execute();

    expect(second).toEqual({ sent: 0, failed: 0, failures: [] });
    expect(harness.channels.slack.deliveries).toHaveLength(1);
  });

  it('claims at most one batch of messages per drain', async () => {
    const harness = createHarness();
    await seedEndpoint(harness, 'whk_1');
    for (let index = 0; index < DRAIN_BATCH_LIMIT + 1; index += 1) await seedOutboxMessage(harness, `out_${String(index)}`, 'whk_1');

    const result = await new DrainOutbox(harness.deps).execute();

    expect(result.sent).toBe(DRAIN_BATCH_LIMIT);
  });
});
