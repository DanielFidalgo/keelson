import type { Clock } from '@keelson/application';

const MILLISECONDS_PER_SECOND = 1000;

// One instance is registered into both the api and the worker, so a test moves time for the whole system at once.
export class ControllableClock implements Clock {
  private instant: Date;

  constructor(start: Date) {
    this.instant = start;
  }

  now(): Date {
    return new Date(this.instant);
  }

  advanceSeconds(seconds: number): void {
    this.instant = new Date(this.instant.getTime() + seconds * MILLISECONDS_PER_SECOND);
  }
}
