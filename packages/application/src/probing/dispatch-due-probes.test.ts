import { slotAt, slotStart } from '@keelson/domain';
import { describe, expect, it } from 'vitest';
import { createHarness, INTERVAL_SECONDS, NOW, seedMonitor } from '../test-support.js';

const CURRENT_SLOT = slotAt(NOW, INTERVAL_SECONDS);

describe('DispatchDueProbes', () => {
  it('dispatch enqueues one job per due active monitor and advances nextProbeAt to the next slot', async () => {
    const harness = createHarness();
    await seedMonitor(harness, { id: 'mon_1' });
    await seedMonitor(harness, { id: 'mon_2' });

    const result = await harness.dispatchDueProbes.execute();

    expect(result).toEqual({ dispatched: 2 });
    expect(harness.queue.jobs).toEqual([
      { monitorId: 'mon_1', slot: CURRENT_SLOT },
      { monitorId: 'mon_2', slot: CURRENT_SLOT },
    ]);
    const nextSlotStart = slotStart(CURRENT_SLOT + 1, INTERVAL_SECONDS);
    expect(harness.db.monitors.records.get('mon_1')?.nextProbeAt).toEqual(nextSlotStart);
    expect(harness.db.monitors.records.get('mon_2')?.nextProbeAt).toEqual(nextSlotStart);
  });

  it('dispatch skips paused monitors and monitors not yet due', async () => {
    const harness = createHarness();
    await seedMonitor(harness, { id: 'mon_paused', status: 'paused' });
    await seedMonitor(harness, { id: 'mon_later', nextProbeAt: new Date(NOW.getTime() + 1) });

    const result = await harness.dispatchDueProbes.execute();

    expect(result).toEqual({ dispatched: 0 });
    expect(harness.queue.jobs).toEqual([]);
  });

  it('dispatching twice in the same slot enqueues each job once', async () => {
    const harness = createHarness();
    await seedMonitor(harness);

    const first = await harness.dispatchDueProbes.execute();
    const second = await harness.dispatchDueProbes.execute();

    expect(first).toEqual({ dispatched: 1 });
    expect(second).toEqual({ dispatched: 0 });
    expect(harness.queue.jobs).toHaveLength(1);
  });

  it('the recording queue ignores a job it already holds', async () => {
    const harness = createHarness();

    await harness.queue.enqueue({ monitorId: 'mon_1', slot: CURRENT_SLOT });
    await harness.queue.enqueue({ monitorId: 'mon_1', slot: CURRENT_SLOT });

    expect(harness.queue.jobs).toHaveLength(1);
  });
});
