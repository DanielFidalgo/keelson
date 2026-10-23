import { z } from 'zod';

const DEFAULT_PORT = 8080;

export type InternalAuthConfig =
  | { mode: 'oidc'; audience: string; allowedEmails: string[] }
  | { mode: 'static'; staticToken: string };

export type SecretStoreConfig = { kind: 'gcp'; project: string } | { kind: 'file'; directory: string };

export interface WorkerConfig {
  port: number;
  databaseUrl: string;
  gcpProject: string | undefined;
  allowPrivateTargets: boolean;
  allowHttpTargets: boolean;
  internalAuth: InternalAuthConfig;
  secretStore: SecretStoreConfig;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`invalid worker configuration:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

const requiredText = z.string().min(1);

// Compose files and Cloud Run both pass blanks for unset values, so an empty variable counts as unset.
const optionalText = z.preprocess((value) => (value === '' ? undefined : value), requiredText.optional());

const emailList = z
  .string()
  .default('')
  .transform((list) => list.split(',').map((email) => email.trim()).filter((email) => email !== ''));

const coreSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
    DATABASE_URL: requiredText,
    GCP_PROJECT: optionalText,
    ALLOW_PRIVATE_TARGETS: z.stringbool().default(false),
    ALLOW_HTTP_TARGETS: z.stringbool().default(false),
  })
  .transform((env) => ({
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    gcpProject: env.GCP_PROJECT,
    allowPrivateTargets: env.ALLOW_PRIVATE_TARGETS,
    allowHttpTargets: env.ALLOW_HTTP_TARGETS,
  }));

// Both choices default to the production option, so a forgotten variable can never select the weaker local one.
const internalAuthSchema = z.preprocess(
  (env) => ({ INTERNAL_AUTH_MODE: 'oidc', ...(env as object) }),
  z.discriminatedUnion('INTERNAL_AUTH_MODE', [
    z
      .object({ INTERNAL_AUTH_MODE: z.literal('static'), INTERNAL_STATIC_TOKEN: requiredText })
      .transform((env): InternalAuthConfig => ({ mode: 'static', staticToken: env.INTERNAL_STATIC_TOKEN })),
    z
      .object({
        INTERNAL_AUTH_MODE: z.literal('oidc'),
        OIDC_AUDIENCE: optionalText,
        WORKER_URL: optionalText,
        INTERNAL_INVOKER_EMAILS: emailList.refine((emails) => emails.length > 0, 'needs at least one email'),
      })
      .transform((env, context): InternalAuthConfig => {
        // The audience is the worker's own URL, which Cloud Tasks and the api put in the tokens they present.
        const audience = env.OIDC_AUDIENCE ?? env.WORKER_URL;
        if (audience !== undefined) return { mode: 'oidc', audience, allowedEmails: env.INTERNAL_INVOKER_EMAILS };
        context.addIssue({ code: 'custom', path: ['OIDC_AUDIENCE'], message: 'is required when WORKER_URL is not set' });
        return z.NEVER;
      }),
  ]),
);

const secretStoreSchema = z.preprocess(
  (env) => ({ SECRET_STORE: 'gcp', ...(env as object) }),
  z.discriminatedUnion('SECRET_STORE', [
    z
      .object({ SECRET_STORE: z.literal('file'), SECRETS_DIR: requiredText })
      .transform((env): SecretStoreConfig => ({ kind: 'file', directory: env.SECRETS_DIR })),
    z
      .object({ SECRET_STORE: z.literal('gcp'), GCP_PROJECT: requiredText })
      .transform((env): SecretStoreConfig => ({ kind: 'gcp', project: env.GCP_PROJECT })),
  ]),
);

function problemsOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

// Parsed once at startup. Each section is validated on its own so one run reports every problem, not just the first.
export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const core = coreSchema.safeParse(env);
  const internalAuth = internalAuthSchema.safeParse(env);
  const secretStore = secretStoreSchema.safeParse(env);
  if (!core.success || !internalAuth.success || !secretStore.success) {
    throw new ConfigError(
      [core, internalAuth, secretStore].flatMap((section) => (section.success ? [] : problemsOf(section.error))),
    );
  }
  return { ...core.data, internalAuth: internalAuth.data, secretStore: secretStore.data };
}
