import { ConflictError, NotFoundError } from '@keelson/application';
import { DomainValidationError } from '@keelson/domain';
import { describe, expect, it } from 'vitest';
import { toProblem } from './problem.js';

describe('toProblem', () => {
  it('maps a DomainValidationError to 400 and lists every problem', () => {
    const problem = toProblem(new DomainValidationError(['name must not be empty', 'url must be an absolute http or https URL']));

    expect(problem).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      errors: ['name must not be empty', 'url must be an absolute http or https URL'],
    });
  });

  it('maps a NotFoundError to 404 with its message', () => {
    expect(toProblem(new NotFoundError('monitor not found'))).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'monitor not found',
    });
  });

  it('maps a ConflictError to 409 with its message', () => {
    expect(toProblem(new ConflictError('already exists'))).toMatchObject({ title: 'Conflict', status: 409, detail: 'already exists' });
  });

  it('answers any other failure with a fixed 500 that carries none of its message', () => {
    const problem = toProblem(new Error('connection refused to db.internal:5432'));

    expect(problem).toEqual({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'internal error' });
  });

  it('keeps a client error status raised by Fastify, such as an oversized body', () => {
    const tooLarge = Object.assign(new Error('Request body is too large'), { statusCode: 413 });

    expect(toProblem(tooLarge)).toMatchObject({ status: 413, detail: 'Request body is too large' });
  });
});
