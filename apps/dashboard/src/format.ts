export function formatTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString();
}
