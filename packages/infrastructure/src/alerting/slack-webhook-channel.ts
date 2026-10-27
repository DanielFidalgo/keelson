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
  const headline = `Keelson: ${alert.type} for ${singleLine(alert.monitorName)}, ${alert.kind} incident${severity}`;
  const listed = alert.changes.slice(0, MAX_LISTED_CHANGES).map((change) => `- ${describeChange(change)}`);
  const omitted = alert.changes.length - listed.length;
  const text = [headline, ...listed, ...(omitted > 0 ? [`and ${String(omitted)} more`] : [])].join('\n');
  return escapeSlackControlCharacters(text);
}

// A line break inside a name would start a new line of the alert, letting a monitored server forge `- ...` entries or a
// second `Keelson:` headline. Only the lines this module joins itself may break.
function singleLine(untrusted: string): string {
  return untrusted.replace(/[\r\n]+/g, ' ');
}

// The text carries no intended mrkdwn, so escaping it whole keeps untrusted names from forming mentions or links.
function escapeSlackControlCharacters(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function describeChange(change: Change): string {
  switch (change.kind) {
    case 'tool_added':
    case 'tool_removed':
    case 'prompt_added':
    case 'prompt_removed':
      return `${change.kind} ${singleLine(change.name)}`;
    case 'resource_added':
    case 'resource_removed':
      return `${change.kind} ${singleLine(change.uri)}`;
    case 'input_schema_changed':
      return `${change.classification} input schema change on ${singleLine(change.tool)}`;
    case 'description_changed':
      return `${change.target} description changed on ${singleLine(change.name)}`;
  }
}
