import { z } from 'zod';

const DEFAULT_PORT = 8080;

export type InternalAuthConfig =
  | { mode: 'oidc'; audience: string; allowedEmails: string[] }
  | { mode: 'static'; staticToken: string };

export type SecretStoreConfig = { kind: 'gcp'; project: string } | { kind: 'file'; directory: string };

export const requiredText = z.string().min(1);

// Compose files and Cloud Run both pass blanks for unset values, so an empty variable counts as unset.
export const optionalText = z.preprocess((value) => (value === '' ? undefined : value), requiredText.optional());

const emailList = z
  .string()
  .default('')
  .transform((list) => list.split(',').map((email) => email.trim()).filter((email) => email !== ''));

export const databaseSchema = z
  .object({ DATABASE_URL: requiredText })
  .transform((env) => ({ databaseUrl: env.DATABASE_URL }));

export const serviceSchema = z
  .object({ PORT: z.coerce.number().int().positive().default(DEFAULT_PORT), GCP_PROJECT: optionalText })
  .transform((env) => ({ port: env.PORT, gcpProject: env.GCP_PROJECT }));

function environmentOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

// A section that depends on the internal auth mode must read the same default as the auth schema itself.
export function withInternalAuthModeDefault(value: unknown): Record<string, unknown> {
  return { INTERNAL_AUTH_MODE: 'oidc', ...environmentOf(value) };
}

// Both choices default to the production option, so a forgotten variable can never select the weaker local one.
// `ownUrlVariable` names the variable holding the URL of the service being configured: it is the default audience
// of the tokens that service verifies, and that URL differs per service.
export function createInternalAuthSchema(ownUrlVariable: string) {
  return z.preprocess(
    (value) => {
      const env = withInternalAuthModeDefault(value);
      return { ...env, OWN_URL: env[ownUrlVariable] };
    },
    z.discriminatedUnion('INTERNAL_AUTH_MODE', [
      z
        .object({ INTERNAL_AUTH_MODE: z.literal('static'), INTERNAL_STATIC_TOKEN: requiredText })
        .transform((env): InternalAuthConfig => ({ mode: 'static', staticToken: env.INTERNAL_STATIC_TOKEN })),
      z
        .object({
          INTERNAL_AUTH_MODE: z.literal('oidc'),
          OIDC_AUDIENCE: optionalText,
          OWN_URL: optionalText,
          INTERNAL_INVOKER_EMAILS: emailList.refine((emails) => emails.length > 0, 'needs at least one email'),
        })
        .transform((env, context): InternalAuthConfig => {
          const audience = env.OIDC_AUDIENCE ?? env.OWN_URL;
          if (audience !== undefined) return { mode: 'oidc', audience, allowedEmails: env.INTERNAL_INVOKER_EMAILS };
          context.addIssue({ code: 'custom', path: ['OIDC_AUDIENCE'], message: `is required when ${ownUrlVariable} is not set` });
          return z.NEVER;
        }),
    ]),
  );
}

export const secretStoreSchema = z.preprocess(
  (value) => ({ SECRET_STORE: 'gcp', ...environmentOf(value) }),
  z.discriminatedUnion('SECRET_STORE', [
    z
      .object({ SECRET_STORE: z.literal('file'), SECRETS_DIR: requiredText })
      .transform((env): SecretStoreConfig => ({ kind: 'file', directory: env.SECRETS_DIR })),
    z
      .object({ SECRET_STORE: z.literal('gcp'), GCP_PROJECT: requiredText })
      .transform((env): SecretStoreConfig => ({ kind: 'gcp', project: env.GCP_PROJECT })),
  ]),
);
