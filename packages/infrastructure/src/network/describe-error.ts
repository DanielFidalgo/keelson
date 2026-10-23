// fetch wraps the real reason in `cause` behind a generic "fetch failed", which is useless in a log or a probe record.
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause : null;
  return cause === null ? error.message : `${error.message}: ${cause.message}`;
}
