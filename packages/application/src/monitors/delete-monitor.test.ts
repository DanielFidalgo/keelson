import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../shared/errors.js';
import { DeleteMonitor } from './delete-monitor.js';
import { createHarness, MONITOR_ID, seedMonitor, TENANT_ID } from '../test-support.js';

describe('DeleteMonitor', () => {
  it('removes the monitor and destroys its secret', async () => {
    const harness = createHarness();
    const authSecretRef = await harness.secrets.create('token', 'token-1');
    await seedMonitor(harness, { authSecretRef });

    await new DeleteMonitor(harness.deps).execute({ tenantId: TENANT_ID, monitorId: MONITOR_ID });

    expect(harness.db.monitors.records.size).toBe(0);
    expect(harness.secrets.refs()).toEqual([]);
  });

  it('removes a monitor that has no secret', async () => {
    const harness = createHarness();
    await seedMonitor(harness);

    await new DeleteMonitor(harness.deps).execute({ tenantId: TENANT_ID, monitorId: MONITOR_ID });

    expect(harness.db.monitors.records.size).toBe(0);
  });

  it('treats another tenant\'s monitor as missing and keeps it with its secret', async () => {
    const harness = createHarness();
    const authSecretRef = await harness.secrets.create('token', 'token-1');
    await seedMonitor(harness, { authSecretRef });

    const attempt = new DeleteMonitor(harness.deps).execute({ tenantId: 'ten_other', monitorId: MONITOR_ID });

    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
    expect(harness.db.monitors.records.size).toBe(1);
    expect(harness.secrets.refs()).toEqual([authSecretRef]);
  });
});
