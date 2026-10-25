import { describe, expect, it } from 'vitest';
import { describeAge } from './useRelativeTime.js';

const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const ago = (seconds: number) => describeAge(NOW - seconds * 1000, NOW);

describe('describeAge', () => {
  it.each([
    [0, 'just now'],
    [59, 'just now'],
    [60, '1 min ago'],
    [120, '2 min ago'],
    [59 * 60, '59 min ago'],
    [60 * 60, '1 h ago'],
    [23 * 3600, '23 h ago'],
    [24 * 3600, '1 d ago'],
    [3 * 24 * 3600, '3 d ago'],
  ])('describes %s seconds as "%s"', (seconds, text) => {
    expect(ago(seconds)).toBe(text);
  });

  it('treats a time slightly in the future, as clock skew produces, as now', () => {
    expect(ago(-30)).toBe('just now');
  });
});
