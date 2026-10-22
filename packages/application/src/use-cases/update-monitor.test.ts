import { DomainValidationError } from '@keelson/domain';
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors.js';
import { UpdateMonitor } from './update-monitor.js';
import { createHarness, MONITOR_ID, seedMonitor, TENANT_ID } from './test-support.js';

const target = { tenantId: TENANT_ID, monitorId: MONITOR_ID };

describe('UpdateMonitor', () => {
  it('changes only the fields it is given', async () => {
    const harness = createHarness();
    const original = await seedMonitor(harness);

    const updated = await new UpdateMonitor(harness.deps).execute({ ...target, name: 'Renamed', status: 'paused' });

    expect(updated).toEqual({ ...original, name: 'Renamed', status: 'paused' });
    expect(harness.db.monitors.records.get(MONITOR_ID)).toEqual(updated);
  });

  it('reschedules the monitor when the interval changes', async () => {
    const harness = createHarness();
    await seedMonitor(harness);

    const updated = await new UpdateMonitor(harness.deps).execute({ ...target, intervalSeconds: 600 });

    expect(updated.intervalSeconds).toBe(600);
    expect(updated.nextProbeAt).toEqual(new Date('2026-10-22T12:10:00Z'));
  });

  it('replaces the bearer token with a new secret and destroys the old one', async () => {
    const harness = createHarness();
    const oldRef = await harness.secrets.create('old', 'token-old');
    await seedMonitor(harness, { authSecretRef: oldRef });

    const updated = await new UpdateMonitor(harness.deps).execute({ ...target, authSecret: 'token-new' });

    expect(updated.authSecretRef).not.toBe(oldRef);
    expect(harness.secrets.refs()).toEqual([updated.authSecretRef]);
    expect(await harness.secrets.read(updated.authSecretRef ?? '')).toBe('token-new');
  });

  it('clearing the token destroys the secret and leaves the monitor without one', async () => {
    const harness = createHarness();
    const oldRef = await harness.secrets.create('old', 'token-old');
    await seedMonitor(harness, { authSecretRef: oldRef });

    const updated = await new UpdateMonitor(harness.deps).execute({ ...target, authSecret: null });

    expect(updated.authSecretRef).toBeNull();
    expect(harness.secrets.refs()).toEqual([]);
  });

  it('keeps the existing secret when no token is given', async () => {
    const harness = createHarness();
    const oldRef = await harness.secrets.create('old', 'token-old');
    await seedMonitor(harness, { authSecretRef: oldRef });

    const updated = await new UpdateMonitor(harness.deps).execute({ ...target, name: 'Renamed' });

    expect(updated.authSecretRef).toBe(oldRef);
    expect(harness.secrets.refs()).toEqual([oldRef]);
  });

  it('treats another tenant\'s monitor as missing and leaves it untouched', async () => {
    const harness = createHarness();
    const original = await seedMonitor(harness);

    const attempt = new UpdateMonitor(harness.deps).execute({ tenantId: 'ten_other', monitorId: MONITOR_ID, name: 'Hijacked' });

    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
    expect(harness.db.monitors.records.get(MONITOR_ID)).toEqual(original);
  });

  it('reports an unknown monitor as missing', async () => {
    const harness = createHarness();
    const attempt = new UpdateMonitor(harness.deps).execute({ ...target, name: 'x' });
    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
  });

  it('destroys the new secret and keeps the old one when the update is rejected', async () => {
    const harness = createHarness();
    const oldRef = await harness.secrets.create('old', 'token-old');
    await seedMonitor(harness, { authSecretRef: oldRef });

    const attempt = new UpdateMonitor(harness.deps).execute({ ...target, authSecret: 'token-new', intervalSeconds: 60 });

    await expect(attempt).rejects.toBeInstanceOf(DomainValidationError);
    expect(harness.secrets.refs()).toEqual([oldRef]);
  });
});
