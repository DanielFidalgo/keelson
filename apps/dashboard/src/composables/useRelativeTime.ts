import { computed, onScopeDispose, ref, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const CLOCK_TICK_MS = 30 * SECOND_MS;

export function describeAge(timestampMs: number, nowMs: number): string {
  // A timestamp slightly ahead of this browser's clock is skew, not the future.
  const age = Math.max(0, nowMs - timestampMs);
  if (age < MINUTE_MS) return 'just now';
  if (age < HOUR_MS) return `${String(Math.floor(age / MINUTE_MS))} min ago`;
  if (age < DAY_MS) return `${String(Math.floor(age / HOUR_MS))} h ago`;
  return `${String(Math.floor(age / DAY_MS))} d ago`;
}

export function formatUtc(timestamp: string): string {
  return `${new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

// One clock serves every relative time on the page, so a table of rows costs one timer, not one per row.
const now = ref(Date.now());
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function followClock(): void {
  if (subscribers++ === 0) {
    now.value = Date.now();
    timer = setInterval(() => {
      now.value = Date.now();
    }, CLOCK_TICK_MS);
  }
  onScopeDispose(() => {
    if (--subscribers === 0) clearInterval(timer);
  });
}

export function useRelativeTime(timestamp: MaybeRefOrGetter<string>): { age: ComputedRef<string>; absolute: ComputedRef<string> } {
  followClock();
  return {
    age: computed(() => describeAge(Date.parse(toValue(timestamp)), now.value)),
    absolute: computed(() => formatUtc(toValue(timestamp))),
  };
}
