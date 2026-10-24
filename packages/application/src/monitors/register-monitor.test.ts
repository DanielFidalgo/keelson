import { DomainValidationError } from '@keelson/domain';
import { describe, expect, it } from 'vitest';
import { RegisterMonitor } from './register-monitor.js';
import type { UnitOfWork } from '../ports/index.js';
import { catalogDescribing, createHarness, failedInspection, NOW, TENANT_ID, upInspection } from '../test-support.js';

const VALID_INPUT = {
  tenantId: TENANT_ID,
  name: 'Docs server',
  url: 'https://mcp.example.com/mcp',
  intervalSeconds: 300,
  authSecret: null,
};

const problemsOf = async (attempt: Promise<unknown>): Promise<readonly string[]> => {
  const error: unknown = await attempt.catch((caught: unknown) => caught);
  if (!(error instanceof DomainValidationError)) throw new Error('expected a DomainValidationError');
  return error.problems;
};

describe('RegisterMonitor', () => {
  it('stores an active monitor that is due immediately once the server answers as an MCP server', async () => {
    const harness = createHarness();
    harness.inspector.respondWith(upInspection(catalogDescribing('Searches the docs')));

    const monitor = await new RegisterMonitor(harness.deps).execute(VALID_INPUT);

    expect(harness.db.monitors.records.get(monitor.id)).toEqual(monitor);
    expect(monitor).toMatchObject({ tenantId: TENANT_ID, status: 'active', authSecretRef: null, nextProbeAt: NOW });
  });

  it('inspects with the bearer token and stores it as a secret referenced by the monitor', async () => {
    const harness = createHarness();
    harness.inspector.respondWith(upInspection(catalogDescribing('Searches the docs')));

    const monitor = await new RegisterMonitor(harness.deps).execute({ ...VALID_INPUT, authSecret: 'token-1' });

    expect(harness.inspector.targets).toEqual([{ url: VALID_INPUT.url, bearerToken: 'token-1' }]);
    expect(monitor.authSecretRef).not.toBeNull();
    expect(await harness.secrets.read(monitor.authSecretRef ?? '')).toBe('token-1');
  });

  it('registering a non-MCP URL is rejected and stores nothing', async () => {
    const harness = createHarness();
    harness.inspector.respondWith({ ...failedInspection('protocol_error'), errorDetail: 'no initialize result' });

    const problems = await problemsOf(
      new RegisterMonitor(harness.deps).execute({ ...VALID_INPUT, authSecret: 'token-1' }),
    );

    expect(problems).toEqual(['url: not an MCP server (protocol_error: no initialize result)']);
    expect(harness.db.monitors.records.size).toBe(0);
    expect(harness.secrets.refs()).toEqual([]);
  });

  it('names only the outcome when the inspection gave no detail', async () => {
    const harness = createHarness();
    harness.inspector.respondWith({ ...failedInspection('timeout'), errorDetail: null });

    const problems = await problemsOf(new RegisterMonitor(harness.deps).execute(VALID_INPUT));

    expect(problems).toEqual(['url: not an MCP server (timeout)']);
  });

  it('registering lists every validation problem at once without contacting the server', async () => {
    const harness = createHarness();

    const problems = await problemsOf(
      new RegisterMonitor(harness.deps).execute({ ...VALID_INPUT, url: 'ftp://x', intervalSeconds: 299 }),
    );

    expect(problems).toHaveLength(2);
    expect(harness.inspector.targets).toEqual([]);
  });

  it('destroys the new secret and rethrows when storing the monitor fails', async () => {
    const harness = createHarness();
    harness.inspector.respondWith(upInspection(catalogDescribing('Searches the docs')));
    const storageFailure = new Error('database unavailable');
    const failingUnitOfWork: UnitOfWork = { run: () => Promise.reject(storageFailure) };

    const attempt = new RegisterMonitor({ ...harness.deps, unitOfWork: failingUnitOfWork }).execute({
      ...VALID_INPUT,
      authSecret: 'token-1',
    });

    await expect(attempt).rejects.toBe(storageFailure);
    expect(harness.secrets.refs()).toEqual([]);
  });
});
