/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies smell of unclear ownership. Resolve before merging.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-app-to-app',
      severity: 'error',
      comment:
        'Apps must not import each other. Share via libs/* (habitat-shared, habitat-utils, habitat-db).',
      from: { path: '^apps/([^/]+)/' },
      to: {
        path: '^apps/([^/]+)/',
        pathNot: '^apps/$1/',
      },
    },
    {
      name: 'palladium-core-no-framework',
      severity: 'error',
      comment:
        '@palladium/core must stay framework-agnostic. Move React/Vue/Svelte code to the binding package.',
      from: { path: '^libs/palladium/core/' },
      to: {
        path: [
          '^libs/palladium/react/',
          '^libs/palladium/vue/',
          '^libs/palladium/svelte/',
          '^libs/palladium/nuxt/',
        ],
      },
    },
    {
      name: 'palladium-bindings-no-cross-framework',
      severity: 'error',
      comment: 'Framework bindings (react/vue/svelte) must not depend on each other.',
      from: { path: '^libs/palladium/(react|vue|svelte)/' },
      to: {
        path: '^libs/palladium/(react|vue|svelte)/',
        pathNot: '^libs/palladium/$1/',
      },
    },
    {
      name: 'palladium-core-no-adapters',
      severity: 'error',
      comment:
        '@palladium/core must not import storage adapters directly — adapters depend on core, not the other way.',
      from: { path: '^libs/palladium/core/' },
      to: {
        path: [
          '^libs/palladium/sqlite-browser/',
          '^libs/palladium/sqlite-capacitor/',
          '^libs/palladium/sqlite-node/',
        ],
      },
    },
    {
      name: 'notifications-core-no-channels',
      severity: 'error',
      comment: '@palladium/notifications-core must not depend on channel-specific packages.',
      from: { path: '^libs/palladium/notifications-core/' },
      to: {
        path: '^libs/palladium/notifications-(?!core)',
      },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
    {
      name: 'not-to-test',
      severity: 'error',
      comment: 'Production code must not import test fixtures or specs.',
      from: { pathNot: ['\\.(test|spec)\\.(ts|tsx|js|jsx)$', '/__tests__/', '/tests/', '/test/'] },
      to: { path: ['\\.(test|spec)\\.(ts|tsx|js|jsx)$', '/__tests__/'] },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment: 'Dependencies must be declared in the importing package’s package.json.',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
  ],

  options: {
    doNotFollow: {
      path: ['node_modules', '\\.nuxt', '\\.output', 'dist', 'build', 'coverage'],
    },
    exclude: {
      path: [
        'node_modules',
        '\\.nuxt',
        '\\.output',
        '\\.sync-engine-import',
        'dist',
        'build',
        'coverage',
        'libs/palladium/example-',
        'libs/palladium/e2e',
        'libs/palladium/crates',
      ],
    },
    includeOnly: '^(apps|libs)/',
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    progress: { type: 'none' },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
