import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

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
  resolve: {
    alias: {
      "@palladium/sqlite-node": fileURLToPath(
        new URL("../sqlite-node/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "@palladium/svelte",
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/index.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
