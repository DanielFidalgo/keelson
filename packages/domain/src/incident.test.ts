import { describe, expect, it } from 'vitest';
import { DomainValidationError } from './errors.js';
import { acknowledgeIncident, escalateIncident, openIncident, resolveIncident } from './incident.js';

const openedAt = new Date('2026-10-22T12:00:00Z');
const later = new Date('2026-10-22T13:00:00Z');
const input = { id: 'inc-1', monitorId: 'mon-1', kind: 'drift', lastDriftId: 'drift-1' } as const;

describe('openIncident', () => {
  it('starts open, unresolved and unacknowledged', () => {
    expect(openIncident(input, openedAt)).toEqual({
      ...input,
      state: 'open',
      openedAt,
      resolvedAt: null,
      resolution: null,
      acknowledgedAt: null,
    });
  });

  it('rejects empty identifiers, listing every problem', () => {
    expect(() => openIncident({ ...input, id: ' ', monitorId: '' }, openedAt)).toThrow(DomainValidationError);
  });
});

describe('resolveIncident', () => {
  it('sets the state, resolution time and resolution', () => {
    const resolved = resolveIncident(openIncident(input, openedAt), 'approved', later);
    expect(resolved).toMatchObject({ state: 'resolved', resolvedAt: later, resolution: 'approved' });
  });

  it('does not mutate the incident it was given', () => {
    const incident = openIncident(input, openedAt);
    resolveIncident(incident, 'reverted', later);
    expect(incident.state).toBe('open');
  });

  it('rejects resolving an already resolved incident', () => {
    const resolved = resolveIncident(openIncident(input, openedAt), 'recovered', later);
    expect(() => resolveIncident(resolved, 'approved', later)).toThrow(DomainValidationError);
  });
});

describe('acknowledgeIncident', () => {
  it('records when the incident was acknowledged', () => {
    expect(acknowledgeIncident(openIncident(input, openedAt), later).acknowledgedAt).toEqual(later);
  });

  it('rejects acknowledging a resolved incident', () => {
    const resolved = resolveIncident(openIncident(input, openedAt), 'recovered', later);
    expect(() => acknowledgeIncident(resolved, later)).toThrow(DomainValidationError);
  });
});

describe('escalateIncident', () => {
  it('points the incident at the latest drift', () => {
    expect(escalateIncident(openIncident(input, openedAt), 'drift-2').lastDriftId).toBe('drift-2');
  });

  it('rejects escalating a resolved incident', () => {
    const resolved = resolveIncident(openIncident(input, openedAt), 'reverted', later);
    expect(() => escalateIncident(resolved, 'drift-2')).toThrow(DomainValidationError);
  });
});
