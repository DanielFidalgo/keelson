import { ApiError } from './client.js';

// The text a person reads when a request fails: the API's own problem detail, or a plain sentence for anything else.
export function describeFailure(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? `The request failed: ${error.message}` : 'The request failed.';
}

// A 400 lists every field that was wrong, so all of them are shown at once rather than one per attempt.
export function describeProblems(error: unknown): string[] {
  const listed = error instanceof ApiError ? error.problem.errors : undefined;
  return listed !== undefined && listed.length > 0 ? listed : [describeFailure(error)];
}
