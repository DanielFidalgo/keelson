import type { Clock } from '../ports.js';

export class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}

  now(): Date {
    return new Date(this.instant);
  }
}
