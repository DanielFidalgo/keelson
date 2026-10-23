import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { securityHandlers } from './auth.js';
import { serviceHandlers } from './handlers.js';
import { startApi, type TestApi } from './test-support.js';

const SPECIFICATION = readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8');

const EXPECTED_OPERATION_IDS = [
  'createMonitor',
  'listMonitors',
  'getMonitor',
  'updateMonitor',
  'deleteMonitor',
  'listProbes',
  'getSnapshot',
  'getDrift',
  'approveBaseline',
  'listIncidents',
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
});
