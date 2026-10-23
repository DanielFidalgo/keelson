import { Webhook } from 'standardwebhooks';
import type { AlertChannel, Delivery, DeliveryResult } from '@keelson/application';
import { describeError } from '../network/describe-error.js';
import { postJson } from './post-json.js';

const MILLISECONDS_PER_SECOND = 1000;

export class StandardWebhookChannel implements AlertChannel {
  private readonly fetch: typeof fetch;

  constructor(deps: { fetch: typeof fetch }) {
    this.fetch = deps.fetch;
  }

  async deliver(delivery: Delivery): Promise<DeliveryResult> {
    if (delivery.signingSecret === null) return { delivered: false, reason: 'endpoint has no signing secret' };
    const { type, ...data } = delivery.alert;
    const body = JSON.stringify({ type, timestamp: delivery.timestamp.toISOString(), data });
    let signature: string;
    try {
      signature = new Webhook(delivery.signingSecret).sign(delivery.messageId, delivery.timestamp, body);
    } catch (error) {
      return { delivered: false, reason: `cannot sign: ${describeError(error)}` };
    }
    return postJson({
      fetch: this.fetch,
      url: delivery.url,
      body,
      headers: {
        'webhook-id': delivery.messageId,
        'webhook-timestamp': String(Math.floor(delivery.timestamp.getTime() / MILLISECONDS_PER_SECOND)),
        'webhook-signature': signature,
      },
    });
  }
}
