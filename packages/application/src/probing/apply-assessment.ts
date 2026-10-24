import {
  computeChanges,
  escalateIncident,
  maxSeverity,
  openIncident,
  resolveIncident,
  type Assessment,
  type Drift,
  type HealthEffect,
  type Incident,
  type IncidentKind,
  type Monitor,
  type Resolution,
  type Snapshot,
} from '@keelson/domain';
import type { Clock, IdGenerator, Transaction } from '../ports/index.js';
import { recordAlerts, type AlertSubject } from '../incidents/record-alerts.js';

export interface AssessmentContext {
  tx: Transaction;
  ids: IdGenerator;
  clock: Clock;
  monitor: Monitor;
  // Null when the probe failed; the drift effects only occur for an up probe, which always has one.
  snapshot: Snapshot | null;
  openDown: Incident | null;
  openDrift: Incident | null;
}

// What raising an alert needs from the surrounding assessment.
export type AlertingContext = Pick<AssessmentContext, 'tx' | 'ids' | 'clock' | 'monitor'>;

// A hash can differ with no classifiable change (for example a schema rewritten into an equivalent form);
// that still deserves an alert, at the lowest severity.
const UNCLASSIFIED_DRIFT_SEVERITY = 'warning';

export async function applyAssessment(context: AssessmentContext, assessment: Assessment): Promise<void> {
  for (const effect of assessment.effects) await applyEffect(context, effect);
  const baselineHash = assessment.effects.reduce(
    (hash, effect) => (effect.type === 'baseline_set' ? effect.hash : hash),
    context.monitor.baselineHash,
  );
  await context.tx.monitors.save({ ...context.monitor, consecutiveFailures: assessment.consecutiveFailures, baselineHash });
}

async function applyEffect(context: AssessmentContext, effect: HealthEffect): Promise<void> {
  switch (effect.type) {
    case 'baseline_set':
      // Stored on the monitor when the assessment is saved, so there is nothing to write here.
      return;
    case 'down_opened':
      return openAndAlert(context, 'down', null);
    case 'down_recovered':
      return resolveAndAlert(context, required(context.openDown, 'open down incident'), 'recovered');
    case 'drift_opened':
      return openAndAlert(context, 'drift', await recordDrift(context));
    case 'drift_escalated':
      return escalateAndAlert(context, await recordDrift(context));
    case 'drift_reverted':
      return resolveAndAlert(context, required(context.openDrift, 'open drift incident'), 'reverted');
  }
}

async function openAndAlert(context: AssessmentContext, kind: IncidentKind, drift: Drift | null): Promise<void> {
  const incident = openIncident(
    { id: context.ids.next(), monitorId: context.monitor.id, kind, lastDriftId: drift?.id ?? null },
    context.clock.now(),
  );
  await context.tx.incidents.save(incident);
  await alert(context, { incident, type: 'incident.opened', drift });
}

async function escalateAndAlert(context: AssessmentContext, drift: Drift): Promise<void> {
  const incident = escalateIncident(required(context.openDrift, 'open drift incident'), drift.id);
  await context.tx.incidents.save(incident);
  await alert(context, { incident, type: 'incident.escalated', drift });
}

export async function resolveAndAlert(context: AlertingContext, open: Incident, resolution: Resolution): Promise<void> {
  const incident = resolveIncident(open, resolution, context.clock.now());
  await context.tx.incidents.save(incident);
  await alert(context, { incident, type: 'incident.resolved', drift: null });
}

function alert(context: AlertingContext, subject: Omit<AlertSubject, 'monitor'>): Promise<void> {
  return recordAlerts(context.tx, { monitor: context.monitor, ...subject }, context);
}

async function recordDrift(context: AssessmentContext): Promise<Drift> {
  const fromHash = required(context.monitor.baselineHash, 'baseline hash');
  const baseline = required(await context.tx.snapshots.get(fromHash), 'baseline snapshot');
  const current = required(context.snapshot, 'current snapshot');
  const changes = computeChanges(baseline.catalog, current.catalog);
  const drift: Drift = {
    id: context.ids.next(),
    monitorId: context.monitor.id,
    fromHash,
    toHash: current.hash,
    changes,
    maxSeverity: maxSeverity(changes) ?? UNCLASSIFIED_DRIFT_SEVERITY,
    detectedAt: context.clock.now(),
  };
  await context.tx.drifts.insert(drift);
  return drift;
}

function required<T>(value: T | null, description: string): T {
  if (value === null) throw new Error(`invariant broken: ${description} is missing`);
  return value;
}
