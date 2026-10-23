import { defineConfig } from 'vitest/config';

// Same as the root config but without the "module" condition: with it, Node loads the ESM build of the
// OpenTelemetry API that Pulumi depends on, and that build cannot be imported (extensionless specifiers).
const resolveConditions = ['@keelson/source', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions: resolveConditions },
  ssr: { resolve: { conditions: resolveConditions } },
  test: { name: 'infra', include: ['**/*.test.ts'] },
});
