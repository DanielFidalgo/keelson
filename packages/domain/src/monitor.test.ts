import { describe, expect, it } from 'vitest';
import { DomainValidationError } from './errors.js';
import { advanceSchedule, newMonitor, updateMonitor } from './monitor.js';
import { problemsOf } from './test-support.js';

const now = new Date('2026-10-22T12:04:59Z');
const valid = {
  id: 'mon-1',
  tenantId: 'tenant-1',
  name: 'Docs server',
  url: 'https://mcp.example.com/mcp',
  intervalSeconds: 300,
  authSecretRef: null,
};

describe('newMonitor', () => {
  it('starts active, due now, with no baseline and no failures', () => {
    expect(newMonitor(valid, now)).toEqual({
      ...valid,
      transport: 'streamable_http',
      nextProbeAt: now,
      baselineHash: null,
      consecutiveFailures: 0,
      status: 'active',
      createdAt: now,
    });
  });

  it('rejects an interval of 299 s and a non-http URL, listing both problems', () => {
    const create = () => newMonitor({ ...valid, intervalSeconds: 299, url: 'ftp://x' }, now);
    expect(create).toThrow(DomainValidationError);
    expect(problemsOf(create)).toHaveLength(2);
  });

  it('rejects a URL that is not absolute', () => {
    expect(problemsOf(() => newMonitor({ ...valid, url: '/mcp' }, now))).toHaveLength(1);
  });

  it('accepts plain http, leaving the https policy to the network layer', () => {
    expect(newMonitor({ ...valid, url: 'http://mcp.example.com' }, now).url).toBe('http://mcp.example.com');
  });

  it('rejects empty identifiers, an empty name and an empty secret reference', () => {
    const create = () => newMonitor({ ...valid, id: '', tenantId: ' ', name: '', authSecretRef: '' }, now);
    expect(problemsOf(create)).toHaveLength(4);
  });

  it('does not share its dates with the caller', () => {
    const monitor = newMonitor(valid, now);
    expect(monitor.nextProbeAt).not.toBe(now);
    expect(monitor.createdAt).not.toBe(now);
  });
});

describe('updateMonitor', () => {
  it('returns a changed copy and leaves the original untouched', () => {
    const original = newMonitor(valid, now);
    const updated = updateMonitor(original, { name: 'Renamed', status: 'paused', authSecretRef: 'secret/1' });
    expect(updated).toMatchObject({ name: 'Renamed', status: 'paused', authSecretRef: 'secret/1' });
    expect(original.name).toBe('Docs server');
  });

  it('can clear the secret reference', () => {
    const withSecret = updateMonitor(newMonitor(valid, now), { authSecretRef: 'secret/1' });
    expect(updateMonitor(withSecret, { authSecretRef: null }).authSecretRef).toBeNull();
  });

  it('rejects an interval below the minimum', () => {
    expect(() => updateMonitor(newMonitor(valid, now), { intervalSeconds: 60 })).toThrow(DomainValidationError);
  });
});

describe('advanceSchedule', () => {
  it('advances nextProbeAt to the start of the next slot', () => {
    const { monitor, slot } = advanceSchedule(newMonitor(valid, now), now);
    expect(monitor.nextProbeAt).toEqual(new Date('2026-10-22T12:05:00Z'));
    expect(slot).toBe(Math.floor(new Date('2026-10-22T12:00:00Z').getTime() / 300_000));
  });
});
