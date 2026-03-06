/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "packages/core/tsconfig.json",
  // Explicit plugin list is required with pnpm (isolated node_modules).
  plugins: [
    "@stryker-mutator/vitest-runner",
    "@stryker-mutator/typescript-checker",
  ],
  vitest: {
    configFile: "packages/core/vitest.config.ts",
  },
  mutate: [
    "packages/core/src/**/*.ts",
    "!packages/core/src/**/__tests__/**",
    "!packages/core/src/index.ts",
    "!packages/core/src/storage.ts",
    "!packages/core/src/mock.ts",
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
