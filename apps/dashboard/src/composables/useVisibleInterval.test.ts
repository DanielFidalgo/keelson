import { effectScope, type EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisibleInterval } from './useVisibleInterval.js';

const INTERVAL_MS = 1_000;

function showTab(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

const scopes: EffectScope[] = [];

function ticking() {
  const tick = vi.fn();
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => {
    useVisibleInterval(tick, INTERVAL_MS);
  });
  return { tick, scope };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // A scope left running would keep listening to the document and answer the next test's visibility changes.
  for (const scope of scopes.splice(0)) scope.stop();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useVisibleInterval', () => {
  it('ticks on every interval while the tab is visible', () => {
    const { tick } = ticking();

    vi.advanceTimersByTime(INTERVAL_MS * 3);

    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('stops the timer itself while the tab is hidden', () => {
    const { tick } = ticking();

    showTab('hidden');

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(INTERVAL_MS * 3);
    expect(tick).not.toHaveBeenCalled();
  });

  it('ticks at once on return, then on every interval after it', () => {
    const { tick } = ticking();
    showTab('hidden');

    showTab('visible');
    expect(tick).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not stack timers when visible is announced twice', () => {
    ticking();

    showTab('visible');
    showTab('visible');

    expect(vi.getTimerCount()).toBe(1);
  });

  it('starts hidden and begins when the tab is first shown', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const { tick } = ticking();
    expect(vi.getTimerCount()).toBe(0);

    showTab('visible');

    expect(tick).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stops for good, and stops listening, when its scope ends', () => {
    const { tick, scope } = ticking();

    scope.stop();
    showTab('visible');
    vi.advanceTimersByTime(INTERVAL_MS * 3);

    expect(tick).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
