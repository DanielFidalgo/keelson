import type { AlertChannel, Delivery, DeliveryResult } from '@keelson/application';
import type { Alert, Change } from '@keelson/domain';
import { postJson } from './post-json.js';

export const MAX_LISTED_CHANGES = 5;

export class SlackWebhookChannel implements AlertChannel {
  private readonly fetch: typeof fetch;

  constructor(deps: { fetch: typeof fetch }) {
    this.fetch = deps.fetch;
  }

  deliver(delivery: Delivery): Promise<DeliveryResult> {
    return postJson({
      fetch: this.fetch,
      url: delivery.url,
      body: JSON.stringify({ text: slackText(delivery.alert) }),
      headers: {},
    });
  }
}

function slackText(alert: Alert): string {
  const severity = alert.severity === null ? '' : ` (${alert.severity})`;
  const headline = `Keelson: ${alert.type} for ${alert.monitorName}, ${alert.kind} incident${severity}`;
  const listed = alert.changes.slice(0, MAX_LISTED_CHANGES).map((change) => `- ${describeChange(change)}`);
  const omitted = alert.changes.length - listed.length;
  return [headline, ...listed, ...(omitted > 0 ? [`and ${String(omitted)} more`] : [])].join('\n');
}

function describeChange(change: Change): string {
  switch (change.kind) {
    case 'tool_added':
    case 'tool_removed':
    case 'prompt_added':
    case 'prompt_removed':
      return `${change.kind} ${change.name}`;
    case 'resource_added':
    case 'resource_removed':
      return `${change.kind} ${change.uri}`;
    case 'input_schema_changed':
      return `${change.classification} input schema change on ${change.tool}`;
    case 'description_changed':
      return `${change.target} description changed on ${change.name}`;
  }
}
