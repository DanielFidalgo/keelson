import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '@keelson/application';

export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
