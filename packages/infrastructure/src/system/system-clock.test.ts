import { describe, expect, it } from 'vitest';
import { SystemClock } from './system-clock.js';
import { UuidGenerator } from './uuid-generator.js';

describe('system adapters', () => {
  it('the clock reports the current time', () => {
    const before = Date.now();

    const reading = new SystemClock().now().getTime();

    expect(reading).toBeGreaterThanOrEqual(before);
    expect(reading).toBeLessThanOrEqual(Date.now());
  });

  it('the id generator issues distinct UUIDs', () => {
    const ids = new UuidGenerator();

    const first = ids.next();

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(ids.next()).not.toBe(first);
  });
});
