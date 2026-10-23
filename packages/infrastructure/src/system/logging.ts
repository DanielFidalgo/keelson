import type { IncomingHttpHeaders } from 'node:http';

export const CLOUD_TRACE_HEADER = 'x-cloud-trace-context';
export const CLOUD_TRACE_FIELD = 'logging.googleapis.com/trace';

// The header is client-controlled, so only a well-formed trace id is allowed into a log line.
const TRACE_ID = /^[0-9a-f]{32}$/i;

// Cloud Run writes stdout lines to Cloud Logging, which reads `severity`, `message` and an RFC 3339 `time` from JSON.
// Requests are reduced to method and url, so neither headers (credentials) nor bodies (bearer tokens) can be logged.
export function createLoggerOptions() {
  return {
    level: 'info',
    messageKey: 'message',
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: { level: (label: string) => ({ severity: label.toUpperCase() }) },
    serializers: { req: (request: { method: string; url: string }) => ({ method: request.method, url: request.url }) },
  };
}

export function cloudTraceBindings(header: string | string[] | undefined, gcpProject: string | undefined): Record<string, string> {
  if (typeof header !== 'string' || gcpProject === undefined) return {};
  const [traceId = ''] = header.split('/');
  return TRACE_ID.test(traceId) ? { [CLOUD_TRACE_FIELD]: `projects/${gcpProject}/traces/${traceId}` } : {};
}

interface ChildLoggerSource<Logger> {
  child(bindings: object, options?: object): Logger;
}

// Pino bindings can only be added when the per-request child logger is made, so this is passed to Fastify as
// `childLoggerFactory` rather than folded into the logger options.
export function createCloudTraceLoggerFactory(gcpProject: string | undefined) {
  return <Logger extends ChildLoggerSource<Logger>>(
    logger: Logger,
    bindings: object,
    options: object,
    request?: { headers: IncomingHttpHeaders },
  ): Logger =>
    logger.child({ ...bindings, ...cloudTraceBindings(request?.headers[CLOUD_TRACE_HEADER], gcpProject) }, options);
}
