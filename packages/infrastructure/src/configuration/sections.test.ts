import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigError, parseConfigSections } from './sections.js';

const first = z.object({ ONE: z.string().min(1) }).transform((env) => ({ one: env.ONE }));
const second = z.object({ TWO: z.coerce.number().int() }).transform((env) => ({ two: env.TWO }));

describe('parseConfigSections', () => {
  it('returns each section under its own name', () => {
    expect(parseConfigSections('demo', { ONE: 'a', TWO: '2' }, { first, second })).toEqual({
      first: { one: 'a' },
      second: { two: 2 },
    });
  });

  it('reports the problems of every section at once, naming the service', () => {
    const failure = captured(() => parseConfigSections('demo', { TWO: 'many' }, { first, second }));

    expect(failure).toBeInstanceOf(ConfigError);
    expect(failure.message).toContain('invalid demo configuration');
    expect(failure.message).toContain('ONE');
    expect(failure.message).toContain('TWO');
  });
});

function captured(work: () => unknown): Error {
  try {
    work();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('expected the work to throw');
}
