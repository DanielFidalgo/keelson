import { describe, expect, it } from 'vitest';
import {
  MAX_CONSECUTIVE_DELIVERY_FAILURES,
  nextDeliveryAttemptAt,
  newWebhookEndpoint,
  recordDeliveryFailure,
  recordDeliverySuccess,
  updateWebhookEndpoint,
  type WebhookEndpoint,
} from './webhook-endpoint.js';
import { problemsOf } from './test-support.js';

const now = new Date('2026-10-22T12:00:00Z');
const standard = {
  id: 'hook-1',
  tenantId: 'tenant-1',
  url: 'https://hooks.example.com/keelson',
  format: 'standard',
  secretRef: 'secret/hook-1',
} as const;

const minutesAfter = (start: Date, minutes: number) => new Date(start.getTime() + minutes * 60_000);

function failTimes(endpoint: WebhookEndpoint, times: number): WebhookEndpoint {
  return Array.from({ length: times }).reduce<WebhookEndpoint>(recordDeliveryFailure, endpoint);
}

describe('newWebhookEndpoint', () => {
  it('starts active with no failures', () => {
    expect(newWebhookEndpoint(standard, now)).toEqual({ ...standard, status: 'active', consecutiveFailures: 0, createdAt: now });
  });

  it('rejects a standard endpoint without a secret reference', () => {
    expect(problemsOf(() => newWebhookEndpoint({ ...standard, secretRef: null }, now))).toEqual([
      'secretRef is required for the standard format',
    ]);
  });

  it('rejects a slack endpoint that carries a secret reference', () => {
    expect(problemsOf(() => newWebhookEndpoint({ ...standard, format: 'slack' }, now))).toEqual([
      'secretRef must be null for the slack format',
    ]);
  });

  it('accepts a slack endpoint without a secret reference', () => {
    expect(newWebhookEndpoint({ ...standard, format: 'slack', secretRef: null }, now).format).toBe('slack');
  });

  it('rejects a non-http URL and empty identifiers, listing every problem', () => {
    expect(problemsOf(() => newWebhookEndpoint({ ...standard, id: '', url: 'ftp://x' }, now))).toEqual([
      'id must not be empty',
      'url must be an absolute http or https URL',
    ]);
  });
});

describe('delivery failures', () => {
  it('keeps the endpoint active below the limit', () => {
    const endpoint = failTimes(newWebhookEndpoint(standard, now), MAX_CONSECUTIVE_DELIVERY_FAILURES - 1);
    expect(endpoint).toMatchObject({ status: 'active', consecutiveFailures: 9 });
  });

  it('disables the endpoint on the 10th consecutive failure', () => {
    const endpoint = failTimes(newWebhookEndpoint(standard, now), MAX_CONSECUTIVE_DELIVERY_FAILURES);
    expect(endpoint).toMatchObject({ status: 'disabled', consecutiveFailures: 10 });
  });

  it('resets the failure count on success', () => {
    const endpoint = recordDeliverySuccess(failTimes(newWebhookEndpoint(standard, now), 4));
    expect(endpoint.consecutiveFailures).toBe(0);
  });
});

describe('nextDeliveryAttemptAt', () => {
  it.each([
    [1, 1],
    [2, 2],
    [4, 8],
    [7, 60],
    [10, 60],
  ])('after %i attempts waits %i minutes', (attempts, minutes) => {
    expect(nextDeliveryAttemptAt(attempts, now)).toEqual(minutesAfter(now, minutes));
  });

  it('rejects zero attempts', () => {
    expect(problemsOf(() => nextDeliveryAttemptAt(0, now))).toEqual(['attempts must be a positive integer']);
  });
});

describe('updateWebhookEndpoint', () => {
  it('changes the url and leaves the original untouched', () => {
    const original = newWebhookEndpoint(standard, now);
    const updated = updateWebhookEndpoint(original, { url: 'https://hooks.example.com/other' });
    expect(updated.url).toBe('https://hooks.example.com/other');
    expect(original.url).toBe(standard.url);
  });

  it('rejects a url that is not absolute http or https', () => {
    const create = () => updateWebhookEndpoint(newWebhookEndpoint(standard, now), { url: 'ftp://x' });
    expect(problemsOf(create)).toHaveLength(1);
  });

  it('re-enabling a disabled endpoint resets its failure count', () => {
    const disabled = failTimes(newWebhookEndpoint(standard, now), MAX_CONSECUTIVE_DELIVERY_FAILURES);
    const reEnabled = updateWebhookEndpoint(disabled, { status: 'active' });
    expect(reEnabled).toMatchObject({ status: 'active', consecutiveFailures: 0 });
  });

  it('keeps the failure count when the endpoint stays active', () => {
    const failing = failTimes(newWebhookEndpoint(standard, now), 3);
    expect(updateWebhookEndpoint(failing, { status: 'active' }).consecutiveFailures).toBe(3);
  });

  it('disabling keeps the failure count', () => {
    const failing = failTimes(newWebhookEndpoint(standard, now), 3);
    expect(updateWebhookEndpoint(failing, { status: 'disabled' })).toMatchObject({ status: 'disabled', consecutiveFailures: 3 });
  });
});
