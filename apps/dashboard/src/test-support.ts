import { flushPromises, mount } from '@vue/test-utils';
import { vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import type { ApiClient, IncidentView, Monitor, MonitorSummary, MonitorWithSummary } from './api/client.js';
import { createNavCounts, navCountsKey, type NavCounts } from './composables/useNavCounts.js';
import { createToasts, toastsKey, type Toasts } from './composables/useToasts.js';
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

export const SUMMARY: MonitorSummary = {
  health: 'up',
  latestProbe: { outcome: 'up', startedAt: '2026-10-22T12:00:00.000Z', latencyMs: 40 },
  recentLatenciesMs: [40, 55, null, 48],
  toolCount: 3,
  openIncident: null,
};

export const MONITOR_WITH_SUMMARY: MonitorWithSummary = { ...MONITOR, summary: SUMMARY };

export const OPEN_DRIFT_INCIDENT: IncidentView = {
  id: 'inc_1',
  monitorId: MONITOR.id,
  monitorName: MONITOR.name,
  severity: 'critical',
  kind: 'drift',
  state: 'open',
  openedAt: '2026-10-22T12:00:00.000Z',
  resolvedAt: null,
  resolution: null,
  acknowledgedAt: null,
  lastDriftId: null,
};

export function pageOf<Item>(items: Item[], nextCursor: string | null = null, total = items.length) {
  return { items, nextCursor, total };
}

// Every call resolves to something harmless, so a test overrides only what it is about.
export function stubClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listMonitors: vi.fn(() => Promise.resolve(pageOf([MONITOR_WITH_SUMMARY]))),
    getMonitor: vi.fn(() => Promise.resolve(MONITOR_WITH_SUMMARY)),
    createMonitor: vi.fn(() => Promise.resolve(MONITOR)),
    updateMonitor: vi.fn(() => Promise.resolve(MONITOR)),
    deleteMonitor: vi.fn(() => Promise.resolve()),
    getHealthCounts: vi.fn(() => Promise.resolve({ total: 1, up: 1, drift: 0, down: 0, paused: 0, pending: 0 })),
    getMonitorStats: vi.fn(() => Promise.resolve({ windowHours: 24, probes: 0, uptimeRatio: null, p95LatencyMs: null })),
    listProbes: vi.fn(() => Promise.resolve(pageOf([]))),
    getSnapshot: vi.fn(() => Promise.resolve({ hash: MONITOR.baselineHash ?? '', catalog: { tools: [], prompts: [], resources: [] } })),
    getDrift: vi.fn(() => Promise.resolve({ drift: null })),
    approveBaseline: vi.fn(() => Promise.resolve(MONITOR)),
    listIncidents: vi.fn(() => Promise.resolve(pageOf([]))),
    getIncidentCounts: vi.fn(() => Promise.resolve({ open: 0, acknowledged: 0, resolved: 0, drift: 0, down: 0 })),
    acknowledgeIncident: vi.fn(() => Promise.resolve(OPEN_DRIFT_INCIDENT)),
    listWebhookEndpoints: vi.fn(() => Promise.resolve(pageOf([]))),
    getWebhookEndpoint: vi.fn(() => Promise.reject(new Error('not stubbed'))),
    createWebhookEndpoint: vi.fn(() => Promise.reject(new Error('not stubbed'))),
    updateWebhookEndpoint: vi.fn(() => Promise.reject(new Error('not stubbed'))),
    deleteWebhookEndpoint: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

export interface PageEnvironment {
  toasts?: Toasts;
  navCounts?: NavCounts;
}

export async function mountPageAt(path: string, client: ApiClient, environment: PageEnvironment = {}) {
  const { toasts = createToasts(), navCounts = createNavCounts(client) } = environment;
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  const wrapper = mount(
    { template: '<RouterView />' },
    { global: { plugins: [router], provide: { [apiClientKey as symbol]: client, [toastsKey as symbol]: toasts, [navCountsKey as symbol]: navCounts } } },
  );
  await flushPromises();
  return wrapper;
}
