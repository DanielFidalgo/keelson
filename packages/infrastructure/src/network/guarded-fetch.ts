import { lookup, type LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';
import { DestinationRefusedError, isPermittedAddress, type TargetPolicy } from './address-policy.js';

export const KEELSON_USER_AGENT = 'Keelson/0.1 (+https://github.com/DanielFidalgo/keelson/blob/main/docs/probes.md)';
export const MAX_REDIRECTS = 5;
// A large real tools/list page is a few hundred KB; anything beyond this is a hostile or broken server.
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const INSECURE_PROTOCOL = 'http:';

// Every address the name resolves to must pass, and the socket is opened to one of the checked addresses.
// Resolving again at connect time would let a rebinding DNS server answer differently the second time.
function guardedLookup(policy: TargetPolicy): LookupFunction {
  return (hostname, options, callback) => {
    // dns.lookup hands back no addresses at all when it fails, so the error is settled before they are touched.
    lookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[] | undefined) => {
      if (error !== null) {
        callback(error, '', 0);
        return;
      }
      const checked = addresses ?? [];
      const refusal = lookupRefusal(hostname, checked, policy);
      const [first] = checked;
      if (refusal !== null) callback(refusal, '', 0);
      else if (options.all === true) callback(null, checked);
      else callback(null, first?.address ?? '', first?.family ?? 0);
    });
  };
}

function lookupRefusal(hostname: string, addresses: LookupAddress[], policy: TargetPolicy): DestinationRefusedError | null {
  if (addresses.length === 0) return new DestinationRefusedError(hostname, 'resolves to nothing');
  const forbidden = addresses.find(({ address }) => !isPermittedAddress(address, policy));
  return forbidden === undefined ? null : new DestinationRefusedError(hostname, `resolves to ${forbidden.address}`);
}

function literalAddressOf(hostname: string): string | null {
  const unbracketed = hostname.replace(/^\[|\]$/g, '');
  return isIP(unbracketed) === 0 ? null : unbracketed;
}

// Checked per connection rather than per request, so every redirect hop that opens a new socket is covered.
function refusalOf(options: buildConnector.Options, policy: TargetPolicy): DestinationRefusedError | null {
  if (options.protocol === INSECURE_PROTOCOL && !policy.allowHttp) {
    return new DestinationRefusedError(options.hostname, 'plain http is not allowed');
  }
  const literal = literalAddressOf(options.hostname);
  if (literal !== null && !isPermittedAddress(literal, policy)) {
    return new DestinationRefusedError(options.hostname, 'address is not allowed');
  }
  return null;
}

function guardedConnector(policy: TargetPolicy): buildConnector.connector {
  const connect = buildConnector({ lookup: guardedLookup(policy) });
  return (options, callback) => {
    const refusal = refusalOf(options, policy);
    if (refusal === null) connect(options, callback);
    else callback(refusal, null);
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SEE_OTHER = 303;
const CREDENTIAL_HEADERS = ['authorization', 'cookie'];
const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding'];

export class RedirectLimitError extends Error {
  constructor() {
    super(`more than ${String(MAX_REDIRECTS)} redirects`);
    this.name = 'RedirectLimitError';
  }
}

export class ResponseTooLargeError extends Error {
  constructor() {
    super(`response body exceeded ${String(MAX_RESPONSE_BYTES)} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

type FetchInit = NonNullable<Parameters<typeof undiciFetch>[1]>;

function isReplayable(body: FetchInit['body']): boolean {
  return body === undefined || body === null || typeof body === 'string' || ArrayBuffer.isView(body);
}

function dropsBody(status: number, method: string): boolean {
  if (status === SEE_OTHER) return method !== 'HEAD';
  return (status === 301 || status === 302) && method === 'POST';
}

// undici ships its own Headers type, which TypeScript treats as distinct from the global one, so header sets cross as pairs.
function headerPairs(headers: Headers): [string, string][] {
  return Array.from(headers.entries());
}

function redirectedInit(init: FetchInit, status: number, from: URL, to: URL): FetchInit {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  if (from.origin !== to.origin) deleteHeaders(headers, CREDENTIAL_HEADERS);
  if (dropsBody(status, method)) {
    deleteHeaders(headers, BODY_HEADERS);
    const redirected: FetchInit = { ...init, method: 'GET', headers: headerPairs(headers) };
    delete redirected.body;
    return redirected;
  }
  if (!isReplayable(init.body)) throw new TypeError('a streamed request body cannot be replayed after a redirect');
  return { ...init, headers: headerPairs(headers) };
}

function deleteHeaders(headers: Headers, names: readonly string[]): void {
  for (const name of names) headers.delete(name);
}

// Redirects are followed here rather than by fetch because fetch allows 20 hops and cannot be told otherwise.
// Each hop opens its connection through the guarded connector, so every hop is checked again.
// A caller that asks for redirect: 'manual' gets the 3xx response back untouched.
async function fetchFollowingRedirects(
  dispatcher: Agent,
  start: URL,
  startInit: FetchInit,
): Promise<Response> {
  let url = start;
  let init = startInit;
  const followsRedirects = startInit.redirect !== 'manual';
  for (let redirectsFollowed = 0; ; redirectsFollowed += 1) {
    const response = await undiciFetch(url, { ...init, redirect: 'manual', dispatcher });
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || location === null) return response;
    if (!followsRedirects) return response;
    await response.body?.cancel();
    if (redirectsFollowed === MAX_REDIRECTS) throw new RedirectLimitError();
    const next = new URL(location, url);
    init = redirectedInit(init, response.status, url, next);
    url = next;
  }
}

function declaresOversizedBody(response: Response): boolean {
  const declared = Number(response.headers.get('content-length'));
  return declared > MAX_RESPONSE_BYTES;
}

// Errors the stream rather than truncating it, so a caller never parses a silently cut-off body.
// Erroring the transform also cancels the upstream, which stops the read.
function limitedTo(maxBytes: number, body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let bytesRead = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesRead += chunk.byteLength;
        if (bytesRead > maxBytes) throw new ResponseTooLargeError();
        controller.enqueue(chunk);
      },
    }),
  );
}

// content-length is checked up front so an honest-but-huge response is refused before any of it is read.
// A server that omits or understates it is caught by the running count instead.
async function withBoundedBody(response: Response): Promise<Response> {
  if (response.body === null) return response;
  if (declaresOversizedBody(response)) {
    await response.body.cancel();
    throw new ResponseTooLargeError();
  }
  return new Response(limitedTo(MAX_RESPONSE_BYTES, response.body), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createGuardedFetch(policy: TargetPolicy): typeof fetch {
  const dispatcher = new Agent({ connect: guardedConnector(policy) });
  return (input, init) => {
    if (input instanceof Request) throw new TypeError('guarded fetch takes a URL, not a Request');
    const headers = new Headers(init?.headers);
    headers.set('user-agent', KEELSON_USER_AGENT);
    return fetchFollowingRedirects(dispatcher, new URL(input), {
      ...(init as FetchInit | undefined),
      headers: headerPairs(headers),
    }).then(withBoundedBody);
  };
}
