import type { IdGenerator } from '../ports.js';

export class SequentialIds implements IdGenerator {
  private counter = 0;

  next(): string {
    this.counter += 1;
    return `id_${String(this.counter)}`;
  }
}
