import type { components } from './schema.js';

// Every shape the dashboard reads comes from openapi.yaml through the generated schema, so the API cannot drift from it unnoticed.
type Schemas = components['schemas'];
export type Monitor = Schemas['Monitor'];
export type Probe = Schemas['Probe'];
export type Incident = Schemas['Incident'];
export type Change = Schemas['Change'];
export type CurrentDrift = Schemas['CurrentDrift'];
export type Problem = Schemas['Problem'];

interface Page<Item> {
  items: Item[];
  nextCursor: string | null;
}

const UNAUTHORIZED = 401;
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

interface Request {
  method?: 'GET' | 'POST';
  query?: Record<string, string>;
  body?: unknown;
}

export interface ApiClient {
  listMonitors(): Promise<Monitor[]>;
  getMonitor(monitorId: string): Promise<Monitor>;
  listProbes(monitorId: string): Promise<Probe[]>;
  getDrift(monitorId: string): Promise<CurrentDrift>;
  approveBaseline(monitorId: string, snapshotHash: string): Promise<Monitor>;
  listOpenIncidents(): Promise<Incident[]>;
  acknowledgeIncident(incidentId: string): Promise<Incident>;
}

export function createApiClient({ apiKey, onUnauthorized, fetch: send = (...args) => fetch(...args) }: ApiClientOptions): ApiClient {
  async function call<Result>(path: string, { method = 'GET', query = {}, body }: Request = {}): Promise<Result> {
    const key = apiKey();
    if (key === null) throw new ApiError(problemFor(UNAUTHORIZED, 'An API key is required.'));

    const queryString = new URLSearchParams(query).toString();
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
    return (await response.json()) as Result;
  }

  async function allPages<Item>(path: string, query: Record<string, string> = {}): Promise<Item[]> {
    const items: Item[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<Item> = await call(path, { query: cursor === null ? query : { ...query, cursor } });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return items;
  }

  const monitorPath = (monitorId: string) => `/v1/monitors/${encodeURIComponent(monitorId)}`;

  return {
    listMonitors: () => allPages('/v1/monitors'),
    getMonitor: (monitorId) => call(monitorPath(monitorId)),
    // Recent history is what the page shows, so the first page is enough.
    listProbes: async (monitorId) => (await call<Page<Probe>>(`${monitorPath(monitorId)}/probes`)).items,
    getDrift: (monitorId) => call(`${monitorPath(monitorId)}/drift`),
    approveBaseline: (monitorId, snapshotHash) =>
      call(`${monitorPath(monitorId)}/baseline`, { method: 'POST', body: { snapshotHash } satisfies Schemas['ApproveBaselineRequest'] }),
    listOpenIncidents: () => allPages('/v1/incidents', { state: 'open' }),
    acknowledgeIncident: (incidentId) => call(`/v1/incidents/${encodeURIComponent(incidentId)}/acknowledge`, { method: 'POST' }),
  };
}
