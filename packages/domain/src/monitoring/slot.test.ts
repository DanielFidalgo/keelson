import { describe, expect, it } from 'vitest';
import { DomainValidationError } from '../shared/errors.js';
import { slotAt, slotStart } from './slot.js';

const FIVE_MINUTES = 300;

describe('slots', () => {
  it('maps 2026-10-22T12:04:59Z at 300 s to the slot starting 12:00:00Z', () => {
    const slot = slotAt(new Date('2026-10-22T12:04:59Z'), FIVE_MINUTES);
    expect(slotStart(slot, FIVE_MINUTES)).toEqual(new Date('2026-10-22T12:00:00Z'));
  });

  it('starts a new slot exactly on the boundary', () => {
    const before = slotAt(new Date('2026-10-22T12:04:59.999Z'), FIVE_MINUTES);
    const on = slotAt(new Date('2026-10-22T12:05:00Z'), FIVE_MINUTES);
    expect(on).toBe(before + 1);
  });

  it('rejects an interval that is not a positive integer', () => {
    expect(() => slotAt(new Date('2026-10-22T12:00:00Z'), 0)).toThrow(DomainValidationError);
    expect(() => slotStart(1, 1.5)).toThrow(DomainValidationError);
  });
});
