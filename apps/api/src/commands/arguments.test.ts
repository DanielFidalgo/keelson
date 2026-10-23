import { describe, expect, it } from 'vitest';
import { parseTenantName } from './arguments.js';

describe('parseTenantName', () => {
  it('reads --name', () => {
    expect(parseTenantName(['--name', 'Acme'])).toBe('Acme');
  });

  it('accepts the --name=value form and trims the value', () => {
    expect(parseTenantName(['--name=  Acme  '])).toBe('Acme');
  });

  it.each([
    ['no arguments', []],
    ['an empty name', ['--name', '']],
    ['a blank name', ['--name', '   ']],
    ['a flag without a value', ['--name']],
  ])('rejects %s', (_description, argv) => {
    expect(() => parseTenantName(argv)).toThrow('--name');
  });

  it('rejects an option it does not know instead of ignoring a typo', () => {
    expect(() => parseTenantName(['--name', 'Acme', '--nmae', 'x'])).toThrow();
  });
});
