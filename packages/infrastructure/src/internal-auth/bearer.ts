const BEARER_PREFIX = 'Bearer ';

export function toBearerHeader(token: string): string {
  return `${BEARER_PREFIX}${token}`;
}

export function bearerTokenFrom(authorizationHeader: string | undefined): string | null {
  if (authorizationHeader === undefined || !authorizationHeader.startsWith(BEARER_PREFIX)) return null;
  const token = authorizationHeader.slice(BEARER_PREFIX.length);
  return token === '' ? null : token;
}
