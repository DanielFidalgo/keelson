import { z } from 'zod';

export class ConfigError extends Error {
  constructor(service: string, problems: string[]) {
    super(`invalid ${service} configuration:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export type ParsedSections<Sections extends Record<string, z.ZodType>> = {
  [Name in keyof Sections]: z.output<Sections[Name]>;
};

function problemsOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

// Each section is validated on its own so one run reports every problem, not just the first.
export function parseConfigSections<Sections extends Record<string, z.ZodType>>(
  service: string,
  env: NodeJS.ProcessEnv,
  sections: Sections,
): ParsedSections<Sections> {
  const parsed: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const [name, schema] of Object.entries(sections)) {
    const result = schema.safeParse(env);
    if (result.success) parsed[name] = result.data;
    else problems.push(...problemsOf(result.error));
  }
  if (problems.length > 0) throw new ConfigError(service, problems);
  // Every section parsed, so each key holds the output type of its own schema; Object.entries loses that pairing.
  return parsed as ParsedSections<Sections>;
}
