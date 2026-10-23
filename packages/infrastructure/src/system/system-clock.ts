import type { Clock } from '@keelson/application';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
