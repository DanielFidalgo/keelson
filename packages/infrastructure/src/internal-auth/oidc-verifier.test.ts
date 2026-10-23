import type { LoginTicket, OAuth2Client, TokenPayload, VerifyIdTokenOptions } from 'google-auth-library';
import { describe, expect, it } from 'vitest';
import { OidcRequestVerifier } from './oidc-verifier.js';

const AUDIENCE = 'https://worker.example.test';
const INVOKER = 'invoker@keelson-test.iam.gserviceaccount.com';

type IdTokenVerifier = Pick<OAuth2Client, 'verifyIdToken'>;

// verifyIdToken is overloaded (promise and callback), which a plain function cannot satisfy without a cast.
function clientReturning(payload: Partial<TokenPayload> | undefined): { client: OAuth2Client; seen: VerifyIdTokenOptions[] } {
  const seen: VerifyIdTokenOptions[] = [];
  const fake = {
    verifyIdToken: (options: VerifyIdTokenOptions) => {
      seen.push(options);
      return Promise.resolve({ getPayload: () => payload } as LoginTicket);
    },
  } satisfies Partial<IdTokenVerifier>;
  return { client: fake as unknown as OAuth2Client, seen };
}

function clientRejecting(reason: Error): OAuth2Client {
  return { verifyIdToken: () => Promise.reject(reason) } as unknown as OAuth2Client;
}

const verifierFor = (client: OAuth2Client): OidcRequestVerifier =>
  new OidcRequestVerifier({ audience: AUDIENCE, allowedEmails: [INVOKER], oauth2Client: client });

describe('OidcRequestVerifier', () => {
  it('accepts a valid token issued to an allowed email and asks Google to check the audience', async () => {
    const { client, seen } = clientReturning({ email: INVOKER, email_verified: true });

    await expect(verifierFor(client).verify('Bearer good-token')).resolves.toBe(true);

    expect(seen).toEqual([{ idToken: 'good-token', audience: AUDIENCE }]);
  });

  it.each([
    ['a missing header', undefined],
    ['an empty header', ''],
    ['a non-bearer scheme', 'Basic abc'],
    ['a bearer header without a token', 'Bearer '],
  ])('rejects %s without consulting Google', async (_name, header) => {
    const { client, seen } = clientReturning({ email: INVOKER, email_verified: true });

    await expect(verifierFor(client).verify(header)).resolves.toBe(false);

    expect(seen).toEqual([]);
  });

  it('rejects a token that fails verification, such as a wrong audience, instead of throwing', async () => {
    const client = clientRejecting(new Error('Wrong recipient, payload audience != requiredAudience'));

    await expect(verifierFor(client).verify('Bearer other-audience-token')).resolves.toBe(false);
  });

  it('rejects a token whose email is not listed', async () => {
    const { client } = clientReturning({ email: 'stranger@example.test', email_verified: true });

    await expect(verifierFor(client).verify('Bearer good-token')).resolves.toBe(false);
  });

  it('rejects a token whose email is not verified', async () => {
    const { client } = clientReturning({ email: INVOKER, email_verified: false });

    await expect(verifierFor(client).verify('Bearer good-token')).resolves.toBe(false);
  });

  it('rejects a token without a payload', async () => {
    const { client } = clientReturning(undefined);

    await expect(verifierFor(client).verify('Bearer good-token')).resolves.toBe(false);
  });
});
