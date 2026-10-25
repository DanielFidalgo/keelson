export const SECONDS_PER_MINUTE = 60;
export const INTERVAL_MINUTES: readonly number[] = [5, 15, 30, 60];
const DEFAULT_INTERVAL_MINUTES = 15;
export const DEFAULT_INTERVAL_SECONDS = DEFAULT_INTERVAL_MINUTES * SECONDS_PER_MINUTE;

export const minutesOf = (seconds: number): number => seconds / SECONDS_PER_MINUTE;
