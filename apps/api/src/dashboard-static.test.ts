import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryUnitOfWork } from '@keelson/application/testing';
import { createLoggerOptions } from '@keelson/infrastructure';
import { asValue } from 'awilix';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadApiConfig } from './config.js';
import { createApiContainer } from './container.js';
import { buildApiServer } from './server.js';

const PROBLEM_JSON = 'application/problem+json';
const INDEX_HTML = '<!doctype html><title>Keelson dashboard</title>';
const ASSET_JS = 'console.log("dashboard asset");';
const BROWSER_NAVIGATION = { accept: 'text/html,application/xhtml+xml' };

const ENVIRONMENT = {
  DATABASE_URL: 'postgres://keelson@localhost/keelson',
  WORKER_URL: 'http://worker.internal:8080',
  INTERNAL_AUTH_MODE: 'static',
  INTERNAL_STATIC_TOKEN: 'test-internal-token',
  SECRET_STORE: 'file',
  SECRETS_DIR: '/var/keelson/secrets',
};

let workDirectory: string;
let server: FastifyInstance | undefined;

beforeEach(() => {
  workDirectory = mkdtempSync(join(tmpdir(), 'keelson-dashboard-'));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(workDirectory, { recursive: true, force: true });
});

function builtDashboard(): string {
  const directory = join(workDirectory, 'dist');
  mkdirSync(join(directory, 'assets'), { recursive: true });
  writeFileSync(join(directory, 'index.html'), INDEX_HTML);
  writeFileSync(join(directory, 'assets', 'app.js'), ASSET_JS);
  return directory;
}

function serverServing(dashboardDirectory: string): FastifyInstance {
  const container = createApiContainer(loadApiConfig({ ...ENVIRONMENT, DASHBOARD_DIR: dashboardDirectory }));
  container.register({
    unitOfWork: asValue(new InMemoryUnitOfWork()),
    loggerOptions: asValue({ ...createLoggerOptions(), level: 'silent' }),
  });
  server = buildApiServer(container);
  return server;
}

describe('serving the dashboard', () => {
  it('serves index.html at / and built assets under their path', async () => {
    const api = serverServing(builtDashboard());

    const root = await api.inject({ method: 'GET', url: '/', headers: BROWSER_NAVIGATION });
    const asset = await api.inject({ method: 'GET', url: '/assets/app.js' });

    expect(root.statusCode).toBe(200);
    expect(root.body).toBe(INDEX_HTML);
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe(ASSET_JS);
  });

  it.each(['/monitors', '/monitors/mon_1', '/incidents', '/webhooks'])('answers the dashboard route %s with index.html, so a reload works', async (path) => {
    const api = serverServing(builtDashboard());

    const response = await api.inject({ method: 'GET', url: path, headers: BROWSER_NAVIGATION });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toBe(INDEX_HTML);
  });

  it('answers a missing asset with 404 rather than a page the browser would run as a script', async () => {
    const api = serverServing(builtDashboard());

    const response = await api.inject({ method: 'GET', url: '/assets/missing.js', headers: { accept: '*/*' } });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_JSON);
  });

  it('leaves the API paths to the API', async () => {
    const api = serverServing(builtDashboard());

    const health = await api.inject({ method: 'GET', url: '/health' });
    const specification = await api.inject({ method: 'GET', url: '/openapi.yaml' });
    const reference = await api.inject({ method: 'GET', url: '/reference/' });
    const unauthorized = await api.inject({ method: 'GET', url: '/v1/monitors', headers: BROWSER_NAVIGATION });

    expect(health.json()).toEqual({ status: 'ok' });
    expect(specification.body).toMatch(/^openapi: 3\.1\.0/);
    expect(reference.body).not.toBe(INDEX_HTML);
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers['content-type']).toContain(PROBLEM_JSON);
  });

  it.each(['/v1/nothing-here', '/v1', '/mcp/other', '/internal/other', '/reference/other', '/health/other'])(
    'keeps the unknown API path %s a problem+json 404 even for a browser',
    async (path) => {
      const api = serverServing(builtDashboard());

      const response = await api.inject({ method: 'GET', url: path, headers: BROWSER_NAVIGATION });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(PROBLEM_JSON);
    },
  );

  it('answers POST to an unknown path with problem+json, as it does without a dashboard', async () => {
    const api = serverServing(builtDashboard());

    const response = await api.inject({ method: 'POST', url: '/monitors/mon_1', headers: BROWSER_NAVIGATION });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_JSON);
  });
});

describe('without a built dashboard', () => {
  it('starts and keeps answering problem+json when the directory does not exist', async () => {
    const api = serverServing(join(workDirectory, 'not-built'));

    const health = await api.inject({ method: 'GET', url: '/health' });
    const root = await api.inject({ method: 'GET', url: '/', headers: BROWSER_NAVIGATION });

    expect(health.statusCode).toBe(200);
    expect(root.statusCode).toBe(404);
    expect(root.headers['content-type']).toContain(PROBLEM_JSON);
  });
});
