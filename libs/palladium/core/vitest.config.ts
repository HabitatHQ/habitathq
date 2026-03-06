import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Vite plugin to treat `node:*` prefixed built-ins as external.
 * Needed because Vite 5.x strips the `node:` prefix before checking
 * builtinModules, so newer built-ins like `node:sqlite` are not
 * auto-detected as external.
 */
function nodeBuiltinsExternal(): Plugin {
  return {
    name: "node-builtins-external",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith("node:")) {
        return { id, external: true };
      }
    },
  };
}

export default defineConfig({
  plugins: [nodeBuiltinsExternal()],
  test: {
    name: "@palladium/core",
    environment: "node",
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
