import type { GoogleAuth } from 'google-auth-library';

export interface InternalCaller {
  authorizationFor(audience: string): Promise<string>;
}

export interface GoogleIdTokenCallerConfig {
  googleAuth: Pick<GoogleAuth, 'getIdTokenClient'>;
}

export class GoogleIdTokenCaller implements InternalCaller {
  private readonly googleAuth: Pick<GoogleAuth, 'getIdTokenClient'>;

  constructor({ googleAuth }: GoogleIdTokenCallerConfig) {
    this.googleAuth = googleAuth;
  }

  // The client caches the token until shortly before it expires, so asking per call is cheap.
  async authorizationFor(audience: string): Promise<string> {
    const idTokenClient = await this.googleAuth.getIdTokenClient(audience);
    const headers = await idTokenClient.getRequestHeaders();
    const authorization = headers.get('authorization');
    if (authorization === null) throw new Error(`Google issued no authorization header for audience ${audience}`);
    return authorization;
  }
}
