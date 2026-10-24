// Cloud Run forwards stdout lines to Cloud Logging, which reads `severity` from a JSON line. This is for the places
// that have no request logger to use, such as a connection pool or a failure that outlives its request.
export function writeErrorLog(event: string, fields: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ severity: 'ERROR', event, ...fields })}\n`);
}
