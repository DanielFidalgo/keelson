import { ApiError } from './client.js';

// The text a person reads when a request fails: the API's own problem detail, or a plain sentence for anything else.
export function describeFailure(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? `The request failed: ${error.message}` : 'The request failed.';
}
