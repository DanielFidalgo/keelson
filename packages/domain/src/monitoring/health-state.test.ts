import { describe, expect, it } from 'vitest';
import { HEALTH_STATE_CASES } from './health-state-cases.js';
import { healthStateOf } from './health-state.js';

describe('healthStateOf', () => {
  it.each(HEALTH_STATE_CASES)('$name', ({ inputs, expected }) => {
    expect(healthStateOf(inputs)).toBe(expected);
  });
});
