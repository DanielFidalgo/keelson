import { describe, expect, it, vi } from 'vitest';
import { stubClient } from '../test-support.js';
import { createNavCounts } from './useNavCounts.js';

describe('createNavCounts', () => {
  it('reads the monitor total, the open incidents and the webhook total', async () => {
    const getWebhooks = vi.fn(() => Promise.resolve({ items: [], nextCursor: 'x', total: 3 }));
    const client = stubClient({
      getHealthCounts: vi.fn(() => Promise.resolve({ total: 19, up: 17, drift: 1, down: 1, paused: 0, pending: 0 })),
      getIncidentCounts: vi.fn(() => Promise.resolve({ open: 2, acknowledged: 1, resolved: 4, drift: 1, down: 1 })),
      listWebhookEndpoints: getWebhooks,
    });
    const counts = createNavCounts(client);

    await counts.refresh();

    expect([counts.monitorCount.value, counts.openIncidentCount.value, counts.webhookCount.value]).toEqual([19, 2, 3]);
    expect(getWebhooks).toHaveBeenCalledWith({ limit: 1 });
  });

  it('shows no counts rather than stale ones when they cannot be read', async () => {
    const client = stubClient({ getHealthCounts: vi.fn().mockResolvedValueOnce({ total: 5 }).mockRejectedValue(new Error('offline')) });
    const counts = createNavCounts(client);
    await counts.refresh();

    await counts.refresh();

    expect([counts.monitorCount.value, counts.openIncidentCount.value, counts.webhookCount.value]).toEqual([null, null, null]);
  });
});
