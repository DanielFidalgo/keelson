/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment: 'The domain imports nothing outside itself except node:crypto (reported by dependency-cruiser as core module crypto). Tests may use the test runner.',
      severity: 'error',
      from: { path: '^packages/domain/src', pathNot: '\\.test\\.ts$' },
      to: { pathNot: ['^packages/domain/src', '^(node:)?crypto$'] },
    },
    {
      name: 'application-depends-on-domain-only',
      comment: 'The application layer may reach only itself and the domain. Tests may use the test runner.',
      severity: 'error',
      from: { path: '^packages/application/src', pathNot: '\\.test\\.ts$' },
      to: { pathNot: ['^packages/application/src', '^packages/domain/src'] },
    },
    {
      name: 'infrastructure-not-apps',
      comment: 'Adapters are composed by apps, never the reverse.',
      severity: 'error',
      from: { path: '^packages/infrastructure/src' },
      to: { path: '^apps/' },
    },
    {
      name: 'api-no-untrusted-egress',
      comment: 'The API process must not hold code that dials out to untrusted hosts.',
      severity: 'error',
      from: { path: '^apps/api' },
      to: {
        path: [
          '^packages/infrastructure/src/network',
          '^packages/infrastructure/src/inspector/sdk-mcp-inspector\\.ts$',
          '^packages/infrastructure/src/egress\\.ts$',
        ],
      },
    },
    {
      name: 'di-only-in-composition-roots',
      comment: 'Dependency-injection containers are wired in the apps only; packages receive their dependencies as constructor arguments.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^node_modules/(awilix|@fastify/awilix)/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Scoped to workspace build output: a bare /dist/ would also hide third-party imports from the rules.
    exclude: { path: '^(packages|apps)/[^/]+/dist/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      // Mirrors tsconfig customConditions so workspace imports resolve to sources, not dist.
      conditionNames: ['@keelson/source', 'import', 'require', 'node', 'default', 'types'],
      exportsFields: ['exports'],
    },
  },
};
