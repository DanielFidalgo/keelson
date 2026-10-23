import vue from '@vitejs/plugin-vue';
import { configDefaults, defineConfig } from 'vitest/config';

// Workspace packages are resolved to their TypeScript sources so tests never depend on a prior build.
// Setting resolve.conditions replaces Vite's server defaults, so the ones tests rely on are restated.
const resolveConditions = ['@keelson/source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions: resolveConditions },
  ssr: { resolve: { conditions: resolveConditions } },
  test: {
    projects: [
      { extends: true, test: { name: 'packages', include: ['packages/*/src/**/*.test.ts'] } },
      { extends: true, test: { name: 'apps', include: ['apps/*/src/**/*.test.ts'], exclude: ['apps/dashboard/**', ...configDefaults.exclude] } },
      // Browser code: it needs a DOM and the Vue compiler, and none of the server-side resolve conditions above.
      { plugins: [vue()], test: { name: 'dashboard', include: ['apps/dashboard/src/**/*.test.ts'], environment: 'happy-dom' } },
      { extends: true, test: { name: 'e2e', include: ['e2e/**/*.test.ts'] } },
      // infra has its own config: Pulumi's OpenTelemetry dependency breaks under the resolve conditions shared above.
      'infra',
    ],
  },
});
