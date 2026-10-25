import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.js';
import { createToasts } from './useToasts.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createToasts', () => {
  it('adds a success toast that goes away by itself', () => {
    const toasts = createToasts();

    toasts.success('Monitor paused');
    expect(toasts.toasts.value.map(({ kind, text }) => [kind, text])).toEqual([['success', 'Monitor paused']]);

    vi.advanceTimersByTime(4_000);
    expect(toasts.toasts.value).toEqual([]);
  });

  it('uses the problem text of an API failure and keeps it on screen longer', () => {
    const toasts = createToasts();
    const problem = { type: 'about:blank', title: 'Bad', status: 400, detail: 'Interval must be at least 300 seconds.' };

    toasts.failure(new ApiError(problem));
    vi.advanceTimersByTime(4_000);

    expect(toasts.toasts.value.map(({ kind, text }) => [kind, text])).toEqual([['failure', 'Interval must be at least 300 seconds.']]);

    vi.advanceTimersByTime(4_000);
    expect(toasts.toasts.value).toEqual([]);
  });

  it('dismisses one toast and leaves the others', () => {
    const toasts = createToasts();
    toasts.success('one');
    toasts.success('two');
    const [first] = toasts.toasts.value;

    toasts.dismiss(first?.id ?? -1);

    expect(toasts.toasts.value.map(({ text }) => text)).toEqual(['two']);
  });

  it('gives every toast its own id', () => {
    const toasts = createToasts();

    toasts.success('same');
    toasts.success('same');

    expect(new Set(toasts.toasts.value.map(({ id }) => id)).size).toBe(2);
  });
});
