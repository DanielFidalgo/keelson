import { defineConfig } from 'vitest/config';

// Workspace packages are resolved to their TypeScript sources so tests never depend on a prior build.
// Setting resolve.conditions replaces Vite's server defaults, so the ones tests rely on are restated.
const resolveConditions = ['@keelson/source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions: resolveConditions },
  ssr: { resolve: { conditions: resolveConditions } },
  test: {
    projects: [
      { extends: true, test: { name: 'packages', include: ['packages/*/src/**/*.test.ts'] } },
      { extends: true, test: { name: 'apps', include: ['apps/*/src/**/*.test.ts'] } },
      { extends: true, test: { name: 'e2e', include: ['e2e/**/*.test.ts'] } },
      { extends: true, test: { name: 'infra', include: ['infra/**/*.test.ts'] } },
    ],
  },
});
