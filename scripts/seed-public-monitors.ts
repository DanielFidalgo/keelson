// Registers the public MCP servers Keelson watches first. Run it against a running api:
//   KEELSON_API_URL=http://localhost:8080 KEELSON_API_KEY=kls_... npm run seed

interface PublicServer {
  name: string;
  url: string;
}

// Public, read-only and anonymous, so no auth secret is registered with them.
const PUBLIC_SERVERS: readonly PublicServer[] = [
  { name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp' },
  { name: 'Microsoft Learn', url: 'https://learn.microsoft.com/api/mcp' },
  { name: 'Cloudflare Docs', url: 'https://docs.mcp.cloudflare.com/mcp' },
  { name: 'Context7', url: 'https://mcp.context7.com/mcp' },
  { name: 'Hugging Face', url: 'https://huggingface.co/mcp' },
];

// Gentler than the 300 s minimum: these are other people's servers.
const PROBE_INTERVAL_SECONDS = 900;
const LIST_PAGE_LIMIT = 200;
const HTTP_CREATED = 201;

interface MonitorPage {
  items: { url: string }[];
  nextCursor: string | null;
}

class SeedFailure extends Error {}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new SeedFailure(`${name} must be set`);
  return value;
}

function isMonitorPage(body: unknown): body is MonitorPage {
  if (typeof body !== 'object' || body === null || !('items' in body) || !Array.isArray(body.items)) return false;
  return body.items.every((item: unknown) => typeof item === 'object' && item !== null && 'url' in item && typeof item.url === 'string');
}

function problemDetail(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string') return body.detail;
  return 'no detail given';
}

class KeelsonApi {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async registeredUrls(): Promise<Set<string>> {
    const urls = new Set<string>();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: String(LIST_PAGE_LIMIT), ...(cursor === null ? {} : { cursor }) });
      const response = await this.request('GET', `/v1/monitors?${query.toString()}`);
      const page: unknown = await response.json();
      if (!response.ok || !isMonitorPage(page)) throw new SeedFailure(`cannot list monitors: HTTP ${String(response.status)} ${problemDetail(page)}`);
      for (const monitor of page.items) urls.add(monitor.url);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return urls;
  }

  // Returns the failure reason, or null once the monitor is registered.
  async register(server: PublicServer): Promise<string | null> {
    const response = await this.request('POST', '/v1/monitors', { ...server, intervalSeconds: PROBE_INTERVAL_SECONDS });
    if (response.status === HTTP_CREATED) return null;
    return `HTTP ${String(response.status)} ${problemDetail(await response.json().catch(() => null))}`;
  }

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? null : JSON.stringify(body),
    });
  }
}

// Returns how many registrations failed, so the exit code can say whether the run was complete.
async function seed(api: KeelsonApi): Promise<number> {
  const alreadyRegistered = await api.registeredUrls();
  let failures = 0;
  for (const server of PUBLIC_SERVERS) {
    if (alreadyRegistered.has(server.url)) {
      console.log(`skipped    ${server.name}: already registered`);
      continue;
    }
    const failure = await api.register(server);
    if (failure === null) console.log(`registered ${server.name}`);
    else {
      failures += 1;
      console.error(`failed     ${server.name}: ${failure}`);
    }
  }
  return failures;
}

try {
  const api = new KeelsonApi(requiredEnv('KEELSON_API_URL').replace(/\/+$/, ''), requiredEnv('KEELSON_API_KEY'));
  if ((await seed(api)) > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof SeedFailure ? error.message : error);
  process.exitCode = 1;
}
