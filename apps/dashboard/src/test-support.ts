import { flushPromises, mount } from '@vue/test-utils';
import { vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import type { ApiClient, Incident, Monitor } from './api/client.js';
import { apiClientKey } from './injection.js';
import { createAppRouter } from './router.js';

export const MONITOR: Monitor = {
  id: 'mon_1',
  name: 'Docs',
  url: 'https://mcp.example.com/mcp',
  transport: 'streamable_http',
  intervalSeconds: 300,
  status: 'active',
  hasAuthSecret: false,
  baselineHash: 'b'.repeat(64),
  consecutiveFailures: 0,
  nextProbeAt: '2026-10-22T12:05:00.000Z',
  createdAt: '2026-10-22T12:00:00.000Z',
};

export const OPEN_DRIFT_INCIDENT: Incident = {
  id: 'inc_1',
  monitorId: MONITOR.id,
  kind: 'drift',
  state: 'open',
  openedAt: '2026-10-22T12:00:00.000Z',
  resolvedAt: null,
  resolution: null,
  acknowledgedAt: null,
  lastDriftId: null,
};

// Every call resolves to something harmless, so a test overrides only what it is about.
export function stubClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listMonitors: vi.fn(() => Promise.resolve([MONITOR])),
    getMonitor: vi.fn(() => Promise.resolve(MONITOR)),
    listProbes: vi.fn(() => Promise.resolve([])),
    getDrift: vi.fn(() => Promise.resolve({ drift: null })),
    approveBaseline: vi.fn(() => Promise.resolve(MONITOR)),
    listOpenIncidents: vi.fn(() => Promise.resolve([])),
    acknowledgeIncident: vi.fn(() => Promise.resolve(OPEN_DRIFT_INCIDENT)),
    ...overrides,
  };
}

export async function mountPageAt(path: string, client: ApiClient) {
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router], provide: { [apiClientKey as symbol]: client } } });
  await flushPromises();
  return wrapper;
}
