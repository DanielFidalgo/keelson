export interface JsonResponse {
  status: number;
  body: unknown;
}

// A tiny wrapper so a test reads as the request it makes; the body is `unknown` and each test parses what it needs.
export class JsonClient {
  constructor(
    private readonly baseUrl: string,
    private readonly bearerToken: string,
  ) {}

  get(path: string): Promise<JsonResponse> {
    return this.send('GET', path);
  }

  post(path: string, body?: unknown): Promise<JsonResponse> {
    return this.send('POST', path, body);
  }

  put(path: string, body: unknown): Promise<JsonResponse> {
    return this.send('PUT', path, body);
  }

  private async send(method: string, path: string, body?: unknown): Promise<JsonResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.bearerToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? null : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  }
}
