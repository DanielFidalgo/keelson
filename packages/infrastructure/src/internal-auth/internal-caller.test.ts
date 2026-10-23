import type { GoogleAuth } from 'google-auth-library';
import { describe, expect, it } from 'vitest';
import { GoogleIdTokenCaller } from './internal-caller.js';

function authIssuing(idToken: string, audiences: string[]): GoogleAuth {
  return {
    getIdTokenClient: (audience: string) => {
      audiences.push(audience);
      return Promise.resolve({ getRequestHeaders: () => Promise.resolve(new Headers({ authorization: `Bearer ${idToken}` })) });
    },
  } as unknown as GoogleAuth;
}

describe('GoogleIdTokenCaller', () => {
  it('asks Google for an ID token for the target audience and presents it as a bearer header', async () => {
    const audiences: string[] = [];
    const caller = new GoogleIdTokenCaller({ googleAuth: authIssuing('id-token', audiences) });

    await expect(caller.authorizationFor('https://worker.example.test')).resolves.toBe('Bearer id-token');
    expect(audiences).toEqual(['https://worker.example.test']);
  });

  it('fails loudly when Google returns no authorization header', async () => {
    const auth = {
      getIdTokenClient: () => Promise.resolve({ getRequestHeaders: () => Promise.resolve(new Headers()) }),
    } as unknown as GoogleAuth;

    await expect(new GoogleIdTokenCaller({ googleAuth: auth }).authorizationFor('https://worker.example.test')).rejects.toThrow(
      'https://worker.example.test',
    );
  });
});
