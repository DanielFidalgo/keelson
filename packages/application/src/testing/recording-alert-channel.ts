import type { AlertChannel, Delivery, DeliveryResult } from '../ports.js';

export class RecordingAlertChannel implements AlertChannel {
  readonly deliveries: Delivery[] = [];
  private readonly scripted: Array<DeliveryResult | Error> = [];

  // An Error is thrown from deliver, standing in for a transport that fails instead of reporting a result.
  respondWith(...outcomes: Array<DeliveryResult | Error>): void {
    this.scripted.push(...outcomes);
  }

  deliver(delivery: Delivery): Promise<DeliveryResult> {
    this.deliveries.push(delivery);
    const outcome = this.scripted.shift() ?? { delivered: true };
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }
}
