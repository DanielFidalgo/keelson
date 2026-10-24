import {
  assessProbe,
  CatalogError,
  createSnapshot,
  type Incident,
  type Monitor,
  type MonitorHealth,
  type Observation,
  type Probe,
  type ProbeOutcome,
  type Snapshot,
} from '@keelson/domain';
import type { Clock, IdGenerator, Inspection, McpInspector, ProbeJob, SecretStore, Transaction, UnitOfWork } from '../ports/index.js';
import { applyAssessment } from './apply-assessment.js';

export interface RunProbeDeps {
  unitOfWork: UnitOfWork;
  inspector: McpInspector;
  secrets: SecretStore;
  clock: Clock;
  ids: IdGenerator;
}

type ObservedServer =
  | { outcome: 'up'; snapshot: Snapshot; errorDetail: string | null }
  | { outcome: Exclude<ProbeOutcome, 'up'>; snapshot: null; errorDetail: string | null };

interface Inspected {
  job: ProbeJob;
  startedAt: Date;
  inspection: Inspection;
  observed: ObservedServer;
}

export class RunProbe {
  constructor(private readonly deps: RunProbeDeps) {}

  async execute(job: ProbeJob): Promise<{ recorded: boolean }> {
    // Read outside the transaction so the slow network call never holds a database lock.
    const monitor = await this.deps.unitOfWork.run((tx) => tx.monitors.get(job.monitorId));
    if (!isProbeable(monitor)) return { recorded: false };

    const startedAt = this.deps.clock.now();
    const inspection = await this.inspect(monitor);
    const inspected: Inspected = { job, startedAt, inspection, observed: observe(inspection) };
    return this.deps.unitOfWork.run((tx) => this.record(tx, inspected));
  }

  private async inspect(monitor: Monitor): Promise<Inspection> {
    const bearerToken = monitor.authSecretRef === null ? null : await this.deps.secrets.read(monitor.authSecretRef);
    return this.deps.inspector.inspect({ url: monitor.url, bearerToken });
  }

  private async record(tx: Transaction, inspected: Inspected): Promise<{ recorded: boolean }> {
    const monitor = await tx.monitors.lockForUpdate(inspected.job.monitorId);
    // The monitor may have been deleted or paused while the inspection was running.
    if (!isProbeable(monitor)) return { recorded: false };

    const inserted = await tx.probes.insertIfAbsent(this.toProbe(inspected));
    if (!inserted) return { recorded: false };

    const { snapshot } = inspected.observed;
    if (snapshot !== null) await tx.snapshots.saveIfAbsent(snapshot, this.deps.clock.now());

    const openDown = await tx.incidents.findOpen(monitor.id, 'down');
    const openDrift = await tx.incidents.findOpen(monitor.id, 'drift');
    const health = await currentHealth(tx, monitor, { openDown, openDrift });
    const assessment = assessProbe(health, toObservation(inspected.observed));
    await applyAssessment({ tx, ...this.deps, monitor, snapshot, openDown, openDrift }, assessment);
    return { recorded: true };
  }

  private toProbe({ job, startedAt, inspection, observed }: Inspected): Probe {
    return {
      id: this.deps.ids.next(),
      monitorId: job.monitorId,
      slot: job.slot,
      startedAt,
      latencyMs: inspection.latencyMs,
      outcome: observed.outcome,
      errorDetail: observed.errorDetail,
      serverName: inspection.serverName,
      serverVersion: inspection.serverVersion,
      snapshotHash: observed.snapshot?.hash ?? null,
    };
  }
}

function isProbeable(monitor: Monitor | null): monitor is Monitor {
  return monitor !== null && monitor.status === 'active';
}

// Snapshotting is pure, so it can run before the probe row is written; a malformed catalog is the
// server's fault and is recorded as a protocol error rather than failing the job.
function observe(inspection: Inspection): ObservedServer {
  if (inspection.outcome !== 'up') {
    return { outcome: inspection.outcome, snapshot: null, errorDetail: inspection.errorDetail };
  }
  if (inspection.catalog === null) return protocolError('server reported up without a catalog');
  try {
    return { outcome: 'up', snapshot: createSnapshot(inspection.catalog), errorDetail: inspection.errorDetail };
  } catch (error) {
    if (error instanceof CatalogError) return protocolError(error.message);
    throw error;
  }
}

function protocolError(errorDetail: string): ObservedServer {
  return { outcome: 'protocol_error', snapshot: null, errorDetail };
}

function toObservation(observed: ObservedServer): Observation {
  return observed.outcome === 'up'
    ? { outcome: 'up', snapshotHash: observed.snapshot.hash }
    : { outcome: observed.outcome };
}

async function currentHealth(
  tx: Transaction,
  monitor: Monitor,
  open: { openDown: Incident | null; openDrift: Incident | null },
): Promise<MonitorHealth> {
  const openDriftId = open.openDrift?.lastDriftId ?? null;
  const openDrift = openDriftId === null ? null : await tx.drifts.get(openDriftId);
  return {
    baselineHash: monitor.baselineHash,
    consecutiveFailures: monitor.consecutiveFailures,
    downOpen: open.openDown !== null,
    openDriftToHash: openDrift?.toHash ?? null,
  };
}
