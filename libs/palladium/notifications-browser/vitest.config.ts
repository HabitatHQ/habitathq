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

// biome-ignore lint/style/noDefaultExport: required by vitest config
export default defineConfig({
  plugins: [nodeBuiltinsExternal()],
  resolve: {
    alias: {
      "@palladium/notifications-core": fileURLToPath(
        new URL("../notifications-core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "@palladium/notifications-browser",
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/index.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
