import { ConflictError, NotFoundError } from '@keelson/application';
import { DomainValidationError } from '@keelson/domain';
import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const CONFLICT = 409;
const SERVER_ERROR = 500;
const INVALID_REQUEST = 'The request is not valid.';

// RFC 9457 with `about:blank`: the title is the status phrase and `detail` carries the specifics.
export interface Problem {
  type: 'about:blank';
  title: string;
  status: number;
  detail: string;
  errors?: string[];
}

export function createProblem(status: number, detail: string, errors?: string[]): Problem {
  const title = STATUS_CODES[status] ?? 'Error';
  return { type: 'about:blank', title, status, detail, ...(errors === undefined ? {} : { errors }) };
}

type ClientFailure = FastifyError & { statusCode: number };

// Fastify raises these itself: schema violations, malformed JSON and the authentication failure from the security handler.
function isClientFailure(error: unknown): error is ClientFailure {
  return (
    error instanceof Error &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= BAD_REQUEST &&
    error.statusCode < SERVER_ERROR
  );
}

// Reads like Fastify's own message, for example `body/intervalSeconds must be integer`, but one entry per violation.
function schemaViolations({ validation, validationContext }: FastifyError): string[] | undefined {
  const context: string = validationContext ?? 'request';
  return validation?.map((issue) => `${context}${issue.instancePath} ${issue.message ?? 'is invalid'}`);
}

// Messages are passed through only for failures the caller caused: server errors can name hosts or credentials.
export function toProblem(error: unknown): Problem {
  if (error instanceof DomainValidationError) return createProblem(BAD_REQUEST, INVALID_REQUEST, [...error.problems]);
  if (error instanceof NotFoundError) return createProblem(NOT_FOUND, error.message);
  if (error instanceof ConflictError) return createProblem(CONFLICT, error.message);
  if (isClientFailure(error)) {
    // The security handler's own message lists scheme names, which mean nothing to an API client.
    if (error.statusCode === UNAUTHORIZED) return createProblem(UNAUTHORIZED, 'A valid API key is required.');
    const violations = schemaViolations(error);
    return violations === undefined ? createProblem(error.statusCode, error.message) : createProblem(error.statusCode, INVALID_REQUEST, violations);
  }
  return createProblem(SERVER_ERROR, 'internal error');
}

export function replyWithProblem(reply: FastifyReply, problemToSend: Problem): FastifyReply {
  if (problemToSend.status === UNAUTHORIZED) void reply.header('www-authenticate', 'Bearer');
  return reply.code(problemToSend.status).type(PROBLEM_CONTENT_TYPE).send(problemToSend);
}

export function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const problemToSend = toProblem(error);
  if (problemToSend.status >= SERVER_ERROR) request.log.error({ err: error }, 'request failed');
  return replyWithProblem(reply, problemToSend);
}

export function handleNotFound(_request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return replyWithProblem(reply, createProblem(NOT_FOUND, 'There is no such route.'));
}
