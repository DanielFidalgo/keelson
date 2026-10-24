import { DomainValidationError } from '../shared/errors.js';

const MILLISECONDS_PER_SECOND = 1000;

// Slots are aligned to the epoch so every worker maps the same instant to the same slot.
export function slotAt(now: Date, intervalSeconds: number): number {
  return Math.floor(now.getTime() / intervalMilliseconds(intervalSeconds));
}

export function slotStart(slot: number, intervalSeconds: number): Date {
  return new Date(slot * intervalMilliseconds(intervalSeconds));
}

function intervalMilliseconds(intervalSeconds: number): number {
  if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
    throw new DomainValidationError(['intervalSeconds must be a positive integer']);
  }
  return intervalSeconds * MILLISECONDS_PER_SECOND;
}
