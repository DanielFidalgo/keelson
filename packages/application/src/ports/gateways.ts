import type {
  Alert,
  ProbeOutcome,
  RawCatalog,
} from '@keelson/domain';

export interface ProbeJob {
  monitorId: string;
  slot: number;
}

// Enqueueing the same job twice must not run it twice: the queue is the first line of defence against duplicate probes.
export interface ProbeQueue {
  enqueue(job: ProbeJob): Promise<void>;
}

export interface InspectionTarget {
  url: string;
  bearerToken: string | null;
}

export interface Inspection {
  outcome: ProbeOutcome;
  latencyMs: number;
  serverName: string | null;
  serverVersion: string | null;
  catalog: RawCatalog | null;
  errorDetail: string | null;
}

export interface McpInspector {
  inspect(target: InspectionTarget): Promise<Inspection>;
}

export interface SecretStore {
  read(ref: string): Promise<string>;
  create(name: string, value: string): Promise<string>;
  destroy(ref: string): Promise<void>;
}

export interface Delivery {
  url: string;
  signingSecret: string | null;
  alert: Alert;
  messageId: string;
  timestamp: Date;
}

export type DeliveryResult = { delivered: true } | { delivered: false; reason: string };

export interface AlertChannel {
  deliver(delivery: Delivery): Promise<DeliveryResult>;
}
