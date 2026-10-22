import { DomainValidationError } from './errors.js';
import { requiredTextProblems, urlProblems } from './validation.js';

export const MAX_CONSECUTIVE_DELIVERY_FAILURES = 10;

const MAX_BACKOFF_MINUTES = 60;
const MILLISECONDS_PER_MINUTE = 60_000;

export type WebhookFormat = 'standard' | 'slack';

export interface WebhookEndpoint {
  readonly id: string;
  readonly tenantId: string;
  readonly url: string;
  readonly format: WebhookFormat;
  readonly secretRef: string | null;
  readonly status: 'active' | 'disabled';
  readonly consecutiveFailures: number;
  readonly createdAt: Date;
}

export interface NewWebhookEndpointInput {
  id: string;
  tenantId: string;
  url: string;
  format: WebhookFormat;
  secretRef: string | null;
}

export function newWebhookEndpoint(input: NewWebhookEndpointInput, now: Date): WebhookEndpoint {
  const problems = [...requiredTextProblems({ id: input.id, tenantId: input.tenantId }), ...urlProblems(input.url), ...secretRefProblems(input)];
  if (problems.length > 0) throw new DomainValidationError(problems);
  return { ...input, status: 'active', consecutiveFailures: 0, createdAt: new Date(now) };
}

export function recordDeliverySuccess(endpoint: WebhookEndpoint): WebhookEndpoint {
  return { ...endpoint, consecutiveFailures: 0 };
}

export function recordDeliveryFailure(endpoint: WebhookEndpoint): WebhookEndpoint {
  const consecutiveFailures = endpoint.consecutiveFailures + 1;
  const status = consecutiveFailures >= MAX_CONSECUTIVE_DELIVERY_FAILURES ? 'disabled' : endpoint.status;
  return { ...endpoint, consecutiveFailures, status };
}

// Doubles each attempt from one minute, capped so a long outage still retries hourly.
export function nextDeliveryAttemptAt(attempts: number, now: Date): Date {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new DomainValidationError(['attempts must be a positive integer']);
  }
  const delayMinutes = Math.min(2 ** (attempts - 1), MAX_BACKOFF_MINUTES);
  return new Date(now.getTime() + delayMinutes * MILLISECONDS_PER_MINUTE);
}

function secretRefProblems({ format, secretRef }: NewWebhookEndpointInput): string[] {
  if (format === 'slack') return secretRef === null ? [] : ['secretRef must be null for the slack format'];
  return secretRef !== null && secretRef.trim() !== '' ? [] : ['secretRef is required for the standard format'];
}
