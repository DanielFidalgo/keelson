import type { DeliveryResult } from '@keelson/application';
import { describeError } from '../network/describe-error.js';

export const DELIVERY_TIMEOUT_MS = 10_000;

const REDIRECT_STATUS_MIN = 300;
const REDIRECT_STATUS_MAX = 399;

function isRedirect(status: number): boolean {
  return status >= REDIRECT_STATUS_MIN && status <= REDIRECT_STATUS_MAX;
}

export interface JsonPost {
  fetch: typeof fetch;
  url: string;
  body: string;
  headers: Record<string, string>;
}

// A transport failure is a result, not an exception: the outbox retries on `delivered: false` and must never see a throw.
export async function postJson(post: JsonPost): Promise<DeliveryResult> {
  try {
    const response = await post.fetch(post.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...post.headers },
      body: post.body,
      // A followed redirect would turn the signed POST into a bodyless GET whose 2xx would pass as a delivery.
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (isRedirect(response.status)) return { delivered: false, reason: `redirect ${String(response.status)}` };
    return response.ok ? { delivered: true } : { delivered: false, reason: `HTTP ${String(response.status)}` };
  } catch (error) {
    return { delivered: false, reason: describeError(error) };
  }
}
