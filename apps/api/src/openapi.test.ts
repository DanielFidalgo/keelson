import { readFileSync } from 'node:fs';
import { SEARCH_MAX_LENGTH } from '@keelson/application';
import { HEALTH_STATES } from '@keelson/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { securityHandlers } from './auth.js';
import { serviceHandlers } from './handlers.js';
import { startApi, type TestApi } from './test-support.js';

const SPECIFICATION = readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8');

const EXPECTED_OPERATION_IDS = [
  'createMonitor',
  'listMonitors',
  'getHealthCounts',
  'getMonitor',
  'getMonitorStats',
  'updateMonitor',
  'deleteMonitor',
  'listProbes',
  'getSnapshot',
  'getDrift',
  'approveBaseline',
  'listIncidents',
  'getIncidentCounts',
  'acknowledgeIncident',
  'createWebhookEndpoint',
  'listWebhookEndpoints',
  'getWebhookEndpoint',
  'updateWebhookEndpoint',
  'deleteWebhookEndpoint',
];

let started: TestApi | undefined;

afterEach(async () => {
  await started?.server.close();
  started = undefined;
});

const operationIdsInSpecification = (): string[] =>
  [...SPECIFICATION.matchAll(/^\s+operationId: (\w+)$/gm)].map((match) => match[1] ?? '');

describe('openapi.yaml', () => {
  it('is an OpenAPI 3.1 document that fastify-openapi-glue accepts on Fastify 5', async () => {
    started = await startApi();

    await expect(started.server.ready()).resolves.toBeDefined();
    expect(SPECIFICATION).toMatch(/^openapi: 3\.1\.\d+$/m);
  });

  it('declares exactly the operations of the brief', () => {
    expect(operationIdsInSpecification().sort()).toEqual([...EXPECTED_OPERATION_IDS].sort());
  });

  it('has a handler for every operationId, and no handler without an operation', () => {
    expect(Object.keys(serviceHandlers).sort()).toEqual(operationIdsInSpecification().sort());
    for (const operationId of operationIdsInSpecification()) {
      expect(serviceHandlers).toHaveProperty(operationId, expect.any(Function));
    }
  });

  it('secures every operation with the bearerAuth scheme, which has a handler', () => {
    expect(SPECIFICATION).toMatch(/^security:\n {2}- bearerAuth: \[\]$/m);
    expect(SPECIFICATION).toMatch(/securitySchemes:\n {4}bearerAuth:\n {6}type: http\n {6}scheme: bearer/);
    expect(securityHandlers).toHaveProperty('bearerAuth', expect.any(Function));
  });

  it('describes errors as application/problem+json', () => {
    expect(SPECIFICATION).toContain('application/problem+json');
  });

  it('limits the search to the length the application accepts', () => {
    expect(SPECIFICATION).toContain(`maxLength: ${String(SEARCH_MAX_LENGTH)}`);
  });

  it('offers exactly the health states of the domain', () => {
    const declared = /HealthState:\n {6}type: string\n {6}enum: \[([^\]]+)\]/.exec(SPECIFICATION)?.[1]?.split(', ');

    expect(declared).toEqual([...HEALTH_STATES]);
  });

  it.each([
    ['/v1/monitors/health-counts', '/v1/monitors/{monitorId}'],
    ['/v1/incidents/counts', '/v1/incidents/{incidentId}/acknowledge'],
  ])('declares %s before %s so a path parameter cannot shadow it', (fixedPath, parameterisedPath) => {
    const declaredAt = (path: string): number => SPECIFICATION.indexOf(`\n  ${path}:`);

    expect(declaredAt(fixedPath)).toBeGreaterThan(-1);
    expect(declaredAt(fixedPath)).toBeLessThan(declaredAt(parameterisedPath));
  });
});
