import type { SnapshotHash } from './snapshot.js';

export type ProbeOutcome = 'up' | 'timeout' | 'connection_error' | 'protocol_error' | 'auth_error';

export interface Probe {
  readonly id: string;
  readonly monitorId: string;
  readonly slot: number;
  readonly startedAt: Date;
  readonly latencyMs: number;
  readonly outcome: ProbeOutcome;
  readonly errorDetail: string | null;
  readonly serverName: string | null;
  readonly serverVersion: string | null;
  readonly snapshotHash: SnapshotHash | null;
}
