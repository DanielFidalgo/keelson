import { onScopeDispose } from 'vue';

// A hidden tab has nobody to show fresh data to, so its timer is stopped. On return the data is refreshed at once, because
// it may be as old as the tab was hidden, and the interval starts over.
export function useVisibleInterval(tick: () => void, intervalMs: number): void {
  let timer: ReturnType<typeof setInterval> | undefined;

  function stop(): void {
    clearInterval(timer);
    timer = undefined;
  }

  function start(): void {
    stop();
    timer = setInterval(tick, intervalMs);
  }

  function followVisibility(): void {
    if (document.visibilityState === 'visible') {
      tick();
      start();
    } else {
      stop();
    }
  }

  if (document.visibilityState === 'visible') start();
  document.addEventListener('visibilitychange', followVisibility);
  onScopeDispose(() => {
    stop();
    document.removeEventListener('visibilitychange', followVisibility);
  });
}
