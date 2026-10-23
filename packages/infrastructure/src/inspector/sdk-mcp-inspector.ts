import {
  Client,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from '@modelcontextprotocol/client';
import type { Clock, Inspection, InspectionTarget, McpInspector } from '@keelson/application';
import type { ProbeOutcome, RawCatalog } from '@keelson/domain';
import { describeError } from '../network/describe-error.js';

export const PROBE_BUDGET_MS = 10_000;
export const MAX_LIST_PAGES = 50;

const CLIENT_INFO = { name: 'keelson', version: '0.1' };
const MAX_ERROR_DETAIL_LENGTH = 500;
const AUTH_ERROR_CODES: ReadonlySet<SdkErrorCode> = new Set([
  SdkErrorCode.ClientHttpAuthentication,
  SdkErrorCode.ClientHttpForbidden,
]);
const AUTH_ERROR_STATUSES: ReadonlySet<number> = new Set([401, 403]);

// The server answered, but not as a well-formed MCP server would.
class MalformedCatalogError extends Error {
  constructor(list: string) {
    super(`${list} list is not an array of objects`);
    this.name = 'MalformedCatalogError';
  }
}

interface Failure {
  outcome: Exclude<ProbeOutcome, 'up'>;
  detail: string;
}

export class SdkMcpInspector implements McpInspector {
  private readonly fetch: typeof fetch;
  private readonly clock: Clock;

  constructor(deps: { fetch: typeof fetch; clock: Clock }) {
    this.fetch = deps.fetch;
    this.clock = deps.clock;
  }

  async inspect(target: InspectionTarget): Promise<Inspection> {
    const startedAt = this.clock.now();
    const budget = new AbortController();
    const budgetTimer = setTimeout(() => {
      budget.abort();
    }, PROBE_BUDGET_MS);
    // The SDK walks pagination itself when no cursor is given, and the first page can only be requested without
    // one, so its page cap is what bounds a server whose nextCursor never ends.
    const client = new Client(CLIENT_INFO, { listMaxPages: MAX_LIST_PAGES });
    try {
      await client.connect(this.transportFor(target), { signal: budget.signal });
      const catalog = await collectCatalog(client, budget.signal);
      return this.inspection(startedAt, {
        outcome: 'up',
        serverName: client.getServerVersion()?.name ?? null,
        serverVersion: client.getServerVersion()?.version ?? null,
        catalog,
        errorDetail: null,
      });
    } catch (error) {
      const failure = classify(error, budget.signal.aborted);
      return this.inspection(startedAt, {
        outcome: failure.outcome,
        serverName: null,
        serverVersion: null,
        catalog: null,
        errorDetail: failure.detail.slice(0, MAX_ERROR_DETAIL_LENGTH),
      });
    } finally {
      clearTimeout(budgetTimer);
      await closeQuietly(client);
    }
  }

  private transportFor(target: InspectionTarget): StreamableHTTPClientTransport {
    const headers: Record<string, string> =
      target.bearerToken === null ? {} : { authorization: `Bearer ${target.bearerToken}` };
    return new StreamableHTTPClientTransport(new URL(target.url), { fetch: this.fetch, requestInit: { headers } });
  }

  private inspection(startedAt: Date, result: Omit<Inspection, 'latencyMs'>): Inspection {
    return { ...result, latencyMs: this.clock.now().getTime() - startedAt.getTime() };
  }
}

async function collectCatalog(client: Client, signal: AbortSignal): Promise<RawCatalog> {
  const capabilities = client.getServerCapabilities();
  const options = { signal };
  // A list the server does not advertise is empty by definition; asking anyway only produces errors and log noise.
  const tools = capabilities?.tools ? (await client.listTools(undefined, options)).tools : [];
  const prompts = capabilities?.prompts ? (await client.listPrompts(undefined, options)).prompts : [];
  const resources = capabilities?.resources ? (await client.listResources(undefined, options)).resources : [];
  return {
    tools: requireObjects(tools, 'tools'),
    prompts: requireObjects(prompts, 'prompts'),
    resources: requireObjects(resources, 'resources'),
  };
}

// The domain's canonicalise assumes arrays of objects, so anything else must stop here as a protocol error.
function requireObjects(list: unknown, name: string): unknown[] {
  const wellFormed =
    Array.isArray(list) && list.every((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry));
  if (!wellFormed) throw new MalformedCatalogError(name);
  return list as unknown[];
}

function classify(error: unknown, budgetExpired: boolean): Failure {
  const detail = detailOf(error);
  if (budgetExpired) return { outcome: 'timeout', detail: `no complete answer within ${String(PROBE_BUDGET_MS)} ms` };
  if (isAuthFailure(error)) return { outcome: 'auth_error', detail };
  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) return { outcome: 'timeout', detail };
  if (isProtocolFailure(error)) return { outcome: 'protocol_error', detail };
  return { outcome: 'connection_error', detail };
}

// describeError drops the HTTP status, which is the most useful fact about a rejected request.
function detailOf(error: unknown): string {
  const detail = describeError(error);
  return error instanceof SdkHttpError ? `HTTP ${String(error.status)}: ${detail}` : detail;
}

function isAuthFailure(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return true;
  if (error instanceof SdkHttpError && AUTH_ERROR_STATUSES.has(error.status)) return true;
  return error instanceof SdkError && AUTH_ERROR_CODES.has(error.code);
}

function isProtocolFailure(error: unknown): boolean {
  if (error instanceof MalformedCatalogError || error instanceof ProtocolError) return true;
  if (error instanceof SdkHttpError) return true;
  return error instanceof SdkError && error.code !== SdkErrorCode.ConnectionClosed && error.code !== SdkErrorCode.SendFailed;
}

// Closing is cleanup after the outcome is already decided; a failure here must not replace that outcome.
async function closeQuietly(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    return;
  }
}
