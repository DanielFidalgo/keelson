import type { OAuth2Client } from 'google-auth-library';
import { bearerTokenFrom } from './bearer.js';
import type { InternalRequestVerifier } from './internal-request-verifier.js';

export interface OidcRequestVerifierConfig {
  audience: string;
  allowedEmails: string[];
  oauth2Client: Pick<OAuth2Client, 'verifyIdToken'>;
}

export class OidcRequestVerifier implements InternalRequestVerifier {
  private readonly audience: string;
  private readonly allowedEmails: ReadonlySet<string>;
  private readonly oauth2Client: Pick<OAuth2Client, 'verifyIdToken'>;

  constructor({ audience, allowedEmails, oauth2Client }: OidcRequestVerifierConfig) {
    this.audience = audience;
    this.allowedEmails = new Set(allowedEmails);
    this.oauth2Client = oauth2Client;
  }

  async verify(authorizationHeader: string | undefined): Promise<boolean> {
    const idToken = bearerTokenFrom(authorizationHeader);
    if (idToken === null) return false;
    try {
      // Signature, expiry and audience are checked by Google's library; any failure surfaces as a rejection.
      const ticket = await this.oauth2Client.verifyIdToken({ idToken, audience: this.audience });
      const payload = ticket.getPayload();
      return payload?.email_verified === true && payload.email !== undefined && this.allowedEmails.has(payload.email);
    } catch {
      return false;
    }
  }
}
