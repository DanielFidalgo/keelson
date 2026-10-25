import {
  DEFAULT_PAGE_LIMIT,
  getCurrentDrift,
  getHealthCounts as readHealthCounts,
  getIncidentCounts as readIncidentCounts,
  getMonitorStats as readMonitorStats,
  getMonitorSummary as readMonitorSummary,
  getSnapshot as readSnapshot,
  getWebhookEndpoint as readWebhookEndpoint,
  listIncidentViews as readIncidentViews,
  listMonitorSummaries as readMonitorSummaries,
  listProbes as readProbes,
  listWebhookEndpoints as readWebhookEndpoints,
  type PageRequest,
  type Transaction,
} from '@keelson/application';
import {
  parseSnapshotHash,
  type HealthState,
  type IncidentKind,
  type MonitorStatus,
  type WebhookEndpoint,
  type WebhookFormat,
} from '@keelson/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authenticatedTenant } from './auth.js';
import {
  presentCountedPage,
  presentDrift,
  presentHealthCounts,
  presentIncident,
  presentIncidentCounts,
  presentIncidentView,
  presentMonitor,
  presentMonitorStats,
  presentMonitorSummary,
  presentProbe,
  presentSnapshot,
  presentWebhookEndpoint,
} from './presenters.js';

const CREATED = 201;
const NO_CONTENT = 204;

interface PageQuery {
  cursor?: string;
  limit?: number;
}

interface MonitorListQuery extends PageQuery {
  health?: HealthState;
  q?: string;
}

interface IncidentListQuery extends PageQuery {
  state?: 'open' | 'resolved';
  kind?: IncidentKind;
  acknowledged?: boolean;
}

interface MonitorParams {
  monitorId: string;
}

interface CreateMonitorBody {
  name: string;
  url: string;
  intervalSeconds: number;
  authSecret?: string | null;
}

interface UpdateMonitorBody {
  name?: string;
  intervalSeconds?: number;
  status?: MonitorStatus;
  authSecret?: string | null;
}

interface CreateWebhookEndpointBody {
  url: string;
  format: WebhookFormat;
}

interface UpdateWebhookEndpointBody {
  url?: string;
  status?: WebhookEndpoint['status'];
}

const pageOf = ({ cursor, limit }: PageQuery): PageRequest => ({ cursor: cursor ?? null, limit: limit ?? DEFAULT_PAGE_LIMIT });

// Only the named keys leave the body, so a field the contract does not define can never reach a use case.
function pickPresent<Body extends object, Key extends keyof Body>(body: Body, keys: readonly Key[]): Partial<Pick<Body, Key>> {
  const picked: Partial<Pick<Body, Key>> = {};
  for (const key of keys) {
    if (key in body) picked[key] = body[key];
  }
  return picked;
}

function inTransaction<Result>(request: FastifyRequest, work: (tx: Transaction) => Promise<Result>): Promise<Result> {
  return request.diScope.cradle.unitOfWork.run(work);
}

// Handlers translate between HTTP and the use cases and hold no rules of their own: validation, ownership
// and state checks all live in the domain and application layers. Names are the operationIds of openapi.yaml.
export const serviceHandlers = {
  async createMonitor(request: FastifyRequest<{ Body: CreateMonitorBody }>, reply: FastifyReply) {
    const { name, url, intervalSeconds, authSecret } = request.body;
    const monitor = await request.diScope.cradle.registerMonitor.execute({
      tenantId: authenticatedTenant(request),
      name,
      url,
      intervalSeconds,
      authSecret: authSecret ?? null,
    });
    return reply.code(CREATED).send(presentMonitor(monitor));
  },

  async listMonitors(request: FastifyRequest<{ Querystring: MonitorListQuery }>) {
    const { health, q } = request.query;
    const page = await inTransaction(request, (tx) =>
      readMonitorSummaries(tx, {
        tenantId: authenticatedTenant(request),
        filter: { health: health ?? null, search: q ?? null },
        page: pageOf(request.query),
      }),
    );
    return presentCountedPage(page, presentMonitorSummary);
  },

  async getHealthCounts(request: FastifyRequest) {
    const counts = await inTransaction(request, (tx) => readHealthCounts(tx, { tenantId: authenticatedTenant(request) }));
    return presentHealthCounts(counts);
  },

  async getMonitor(request: FastifyRequest<{ Params: MonitorParams }>) {
    const summary = await inTransaction(request, (tx) =>
      readMonitorSummary(tx, { tenantId: authenticatedTenant(request), monitorId: request.params.monitorId }),
    );
    return presentMonitorSummary(summary);
  },

  async getMonitorStats(request: FastifyRequest<{ Params: MonitorParams }>) {
    const stats = await inTransaction(request, (tx) =>
      readMonitorStats(tx, {
        tenantId: authenticatedTenant(request),
        monitorId: request.params.monitorId,
        now: request.diScope.cradle.clock.now(),
      }),
    );
    return presentMonitorStats(stats);
  },

  async updateMonitor(request: FastifyRequest<{ Params: MonitorParams; Body: UpdateMonitorBody }>) {
    const monitor = await request.diScope.cradle.updateMonitor.execute({
      tenantId: authenticatedTenant(request),
      monitorId: request.params.monitorId,
      ...pickPresent(request.body, ['name', 'intervalSeconds', 'status', 'authSecret']),
    });
    return presentMonitor(monitor);
  },

  async deleteMonitor(request: FastifyRequest<{ Params: MonitorParams }>, reply: FastifyReply) {
    await request.diScope.cradle.deleteMonitor.execute({
      tenantId: authenticatedTenant(request),
      monitorId: request.params.monitorId,
    });
    return reply.code(NO_CONTENT).send();
  },

  async listProbes(request: FastifyRequest<{ Params: MonitorParams; Querystring: PageQuery }>) {
    const page = await inTransaction(request, (tx) =>
      readProbes(tx, {
        tenantId: authenticatedTenant(request),
        monitorId: request.params.monitorId,
        page: pageOf(request.query),
      }),
    );
    return presentCountedPage(page, presentProbe);
  },

  async getSnapshot(request: FastifyRequest<{ Params: MonitorParams & { hash: string } }>) {
    const snapshotHash = parseSnapshotHash(request.params.hash);
    const snapshot = await inTransaction(request, (tx) =>
      readSnapshot(tx, { tenantId: authenticatedTenant(request), monitorId: request.params.monitorId, snapshotHash }),
    );
    return presentSnapshot(snapshot);
  },

  async getDrift(request: FastifyRequest<{ Params: MonitorParams }>) {
    const drift = await inTransaction(request, (tx) =>
      getCurrentDrift(tx, { tenantId: authenticatedTenant(request), monitorId: request.params.monitorId }),
    );
    return presentDrift(drift);
  },

  async approveBaseline(request: FastifyRequest<{ Params: MonitorParams; Body: { snapshotHash: string } }>) {
    const monitor = await request.diScope.cradle.approveBaseline.execute({
      tenantId: authenticatedTenant(request),
      monitorId: request.params.monitorId,
      snapshotHash: parseSnapshotHash(request.body.snapshotHash),
    });
    return presentMonitor(monitor);
  },

  async listIncidents(request: FastifyRequest<{ Querystring: IncidentListQuery }>) {
    const { state, kind, acknowledged } = request.query;
    const page = await inTransaction(request, (tx) =>
      readIncidentViews(tx, {
        tenantId: authenticatedTenant(request),
        filter: { state: state ?? null, kind: kind ?? null, acknowledged: acknowledged ?? null },
        page: pageOf(request.query),
      }),
    );
    return presentCountedPage(page, presentIncidentView);
  },

  async getIncidentCounts(request: FastifyRequest) {
    const counts = await inTransaction(request, (tx) => readIncidentCounts(tx, { tenantId: authenticatedTenant(request) }));
    return presentIncidentCounts(counts);
  },

  async acknowledgeIncident(request: FastifyRequest<{ Params: { incidentId: string } }>) {
    const incident = await request.diScope.cradle.acknowledgeIncident.execute({
      tenantId: authenticatedTenant(request),
      incidentId: request.params.incidentId,
    });
    return presentIncident(incident);
  },

  async createWebhookEndpoint(request: FastifyRequest<{ Body: CreateWebhookEndpointBody }>, reply: FastifyReply) {
    const { url, format } = request.body;
    const { endpoint, signingSecret } = await request.diScope.cradle.registerWebhookEndpoint.execute({
      tenantId: authenticatedTenant(request),
      url,
      format,
    });
    // The only response that ever carries the secret; every other endpoint response goes through presentWebhookEndpoint alone.
    return reply.code(CREATED).send({ ...presentWebhookEndpoint(endpoint), signingSecret });
  },

  async listWebhookEndpoints(request: FastifyRequest<{ Querystring: PageQuery }>) {
    const page = await inTransaction(request, (tx) =>
      readWebhookEndpoints(tx, { tenantId: authenticatedTenant(request), page: pageOf(request.query) }),
    );
    return presentCountedPage(page, presentWebhookEndpoint);
  },

  async getWebhookEndpoint(request: FastifyRequest<{ Params: { endpointId: string } }>) {
    const endpoint = await inTransaction(request, (tx) =>
      readWebhookEndpoint(tx, { tenantId: authenticatedTenant(request), endpointId: request.params.endpointId }),
    );
    return presentWebhookEndpoint(endpoint);
  },

  async updateWebhookEndpoint(request: FastifyRequest<{ Params: { endpointId: string }; Body: UpdateWebhookEndpointBody }>) {
    const endpoint = await request.diScope.cradle.updateWebhookEndpoint.execute({
      tenantId: authenticatedTenant(request),
      endpointId: request.params.endpointId,
      ...pickPresent(request.body, ['url', 'status']),
    });
    return presentWebhookEndpoint(endpoint);
  },

  async deleteWebhookEndpoint(request: FastifyRequest<{ Params: { endpointId: string } }>, reply: FastifyReply) {
    await request.diScope.cradle.deleteWebhookEndpoint.execute({
      tenantId: authenticatedTenant(request),
      endpointId: request.params.endpointId,
    });
    return reply.code(NO_CONTENT).send();
  },
};
