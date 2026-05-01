/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
// biome-ignore lint/style/noDefaultExport: required by Stryker config
export default {
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "core/tsconfig.json",
  // Explicit plugin list is required with pnpm (isolated node_modules).
  plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
  vitest: {
    configFile: "core/vitest.config.ts",
  },
  mutate: [
    "core/src/**/*.ts",
    "!core/src/**/__tests__/**",
    "!core/src/index.ts",
    "!core/src/storage.ts",
    "!core/src/mock.ts",
  ],
  // Prevent Stryker from scanning Rust build artefacts and coverage HTML.
  ignorePatterns: ["coverage", "target", ".stryker-tmp", "reports", "dist"],
  reporters: ["html", "clear-text", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/report.json" },
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
  thresholds: {
    high: 80,
    low: 60,
    break: 0,
  },
};
