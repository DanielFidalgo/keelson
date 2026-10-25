import type { components, operations } from './schema.js';

// Every shape the dashboard reads comes from openapi.yaml through the generated schema, so the API cannot drift from it unnoticed.
type Schemas = components['schemas'];
export type Monitor = Schemas['Monitor'];
export type MonitorSummary = Schemas['MonitorSummary'];
export type MonitorWithSummary = Schemas['MonitorWithSummary'];
export type MonitorPage = Schemas['MonitorPage'];
export type HealthState = Schemas['HealthState'];
export type HealthCounts = Schemas['HealthCounts'];
export type MonitorStats = Schemas['MonitorStats'];
export type CreateMonitorRequest = Schemas['CreateMonitorRequest'];
export type UpdateMonitorRequest = Schemas['UpdateMonitorRequest'];
export type Probe = Schemas['Probe'];
export type ProbePage = Schemas['ProbePage'];
export type Snapshot = Schemas['Snapshot'];
export type Change = Schemas['Change'];
export type CurrentDrift = Schemas['CurrentDrift'];
export type Incident = Schemas['Incident'];
export type IncidentView = Schemas['IncidentView'];
export type IncidentPage = Schemas['IncidentPage'];
export type IncidentCounts = Schemas['IncidentCounts'];
export type WebhookEndpoint = Schemas['WebhookEndpoint'];
export type CreatedWebhookEndpoint = Schemas['CreatedWebhookEndpoint'];
export type WebhookEndpointPage = Schemas['WebhookEndpointPage'];
export type CreateWebhookEndpointRequest = Schemas['CreateWebhookEndpointRequest'];
export type UpdateWebhookEndpointRequest = Schemas['UpdateWebhookEndpointRequest'];
export type Problem = Schemas['Problem'];

// A filter the page has not set arrives as null (or empty, for search) and is left out of the request.
type ListParams<Operation extends keyof operations> = { [Name in keyof NonNullable<operations[Operation]['parameters']['query']>]?: NonNullable<operations[Operation]['parameters']['query']>[Name] | null };
export type MonitorListParams = ListParams<'listMonitors'>;
export type IncidentListParams = ListParams<'listIncidents'>;
export type ProbeListParams = ListParams<'listProbes'>;
export type WebhookEndpointListParams = ListParams<'listWebhookEndpoints'>;

const UNAUTHORIZED = 401;
const NO_CONTENT = 204;
const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export class ApiError extends Error {
  readonly status: number;

  constructor(readonly problem: Problem) {
    super(problem.detail);
    this.name = 'ApiError';
    this.status = problem.status;
  }
}

function problemFor(status: number, detail: string): Problem {
  return { type: 'about:blank', title: '', status, detail };
}

async function failureOf(response: Response): Promise<ApiError> {
  const isProblem = response.headers.get('content-type')?.includes(PROBLEM_CONTENT_TYPE) ?? false;
  if (isProblem) {
    try {
      return new ApiError((await response.json()) as Problem);
    } catch {
      // A body that is not the promised JSON is reported like any other unreadable answer.
    }
  }
  return new ApiError(problemFor(response.status, `The API answered ${String(response.status)}.`));
}

export interface ApiClientOptions {
  apiKey: () => string | null;
  onUnauthorized: () => void;
  fetch?: typeof fetch;
}

type QueryValue = string | number | boolean | null | undefined;

interface Request {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export interface ApiClient {
  listMonitors(params: MonitorListParams): Promise<MonitorPage>;
  getMonitor(monitorId: string): Promise<MonitorWithSummary>;
  createMonitor(request: CreateMonitorRequest): Promise<Monitor>;
  updateMonitor(monitorId: string, request: UpdateMonitorRequest): Promise<Monitor>;
  deleteMonitor(monitorId: string): Promise<void>;
  getHealthCounts(): Promise<HealthCounts>;
  getMonitorStats(monitorId: string): Promise<MonitorStats>;
  listProbes(monitorId: string, params: ProbeListParams): Promise<ProbePage>;
  getSnapshot(monitorId: string, hash: string): Promise<Snapshot>;
  getDrift(monitorId: string): Promise<CurrentDrift>;
  approveBaseline(monitorId: string, snapshotHash: string): Promise<Monitor>;
  listIncidents(params: IncidentListParams): Promise<IncidentPage>;
  getIncidentCounts(): Promise<IncidentCounts>;
  acknowledgeIncident(incidentId: string): Promise<Incident>;
  listWebhookEndpoints(params: WebhookEndpointListParams): Promise<WebhookEndpointPage>;
  getWebhookEndpoint(endpointId: string): Promise<WebhookEndpoint>;
  createWebhookEndpoint(request: CreateWebhookEndpointRequest): Promise<CreatedWebhookEndpoint>;
  updateWebhookEndpoint(endpointId: string, request: UpdateWebhookEndpointRequest): Promise<WebhookEndpoint>;
  deleteWebhookEndpoint(endpointId: string): Promise<void>;
}

function queryStringOf(query: Record<string, QueryValue>): string {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    parameters.set(name, String(value));
  }
  return parameters.toString();
}

export function createApiClient({ apiKey, onUnauthorized, fetch: send = (...args) => fetch(...args) }: ApiClientOptions): ApiClient {
  async function call<Result>(path: string, { method = 'GET', query = {}, body }: Request = {}): Promise<Result> {
    const key = apiKey();
    if (key === null) throw new ApiError(problemFor(UNAUTHORIZED, 'An API key is required.'));

    const queryString = queryStringOf(query);
    const headers: Record<string, string> = { authorization: `Bearer ${key}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await send(queryString === '' ? path : `${path}?${queryString}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      if (response.status === UNAUTHORIZED) onUnauthorized();
      throw await failureOf(response);
    }
    if (response.status === NO_CONTENT) return undefined as Result;
    return (await response.json()) as Result;
  }

  const segment = encodeURIComponent;
  const monitorPath = (monitorId: string) => `/v1/monitors/${segment(monitorId)}`;
  const endpointPath = (endpointId: string) => `/v1/webhook-endpoints/${segment(endpointId)}`;

  return {
    listMonitors: (params) => call('/v1/monitors', { query: params }),
    getMonitor: (monitorId) => call(monitorPath(monitorId)),
    createMonitor: (request) => call('/v1/monitors', { method: 'POST', body: request }),
    updateMonitor: (monitorId, request) => call(monitorPath(monitorId), { method: 'PATCH', body: request }),
    deleteMonitor: (monitorId) => call(monitorPath(monitorId), { method: 'DELETE' }),
    getHealthCounts: () => call('/v1/monitors/health-counts'),
    getMonitorStats: (monitorId) => call(`${monitorPath(monitorId)}/stats`),
    listProbes: (monitorId, params) => call(`${monitorPath(monitorId)}/probes`, { query: params }),
    getSnapshot: (monitorId, hash) => call(`${monitorPath(monitorId)}/snapshots/${segment(hash)}`),
    getDrift: (monitorId) => call(`${monitorPath(monitorId)}/drift`),
    approveBaseline: (monitorId, snapshotHash) =>
      call(`${monitorPath(monitorId)}/baseline`, { method: 'POST', body: { snapshotHash } satisfies Schemas['ApproveBaselineRequest'] }),
    listIncidents: (params) => call('/v1/incidents', { query: params }),
    getIncidentCounts: () => call('/v1/incidents/counts'),
    acknowledgeIncident: (incidentId) => call(`/v1/incidents/${segment(incidentId)}/acknowledge`, { method: 'POST' }),
    listWebhookEndpoints: (params) => call('/v1/webhook-endpoints', { query: params }),
    getWebhookEndpoint: (endpointId) => call(endpointPath(endpointId)),
    createWebhookEndpoint: (request) => call('/v1/webhook-endpoints', { method: 'POST', body: request }),
    updateWebhookEndpoint: (endpointId, request) => call(endpointPath(endpointId), { method: 'PATCH', body: request }),
    deleteWebhookEndpoint: (endpointId) => call(endpointPath(endpointId), { method: 'DELETE' }),
  };
}
