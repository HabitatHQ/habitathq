/**
 * Integration tests: exercises createNotifications() with real channel implementations
 * (BrowserNotificationChannel, ToastChannel) in a simulated browser environment.
 *
 * Run with:  pnpm exec vitest run --config packages/notifications-core/vitest.integration.config.ts
 */
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
      "@palladium/notifications-core": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      "@palladium/notifications-toast": fileURLToPath(
        new URL("../notifications-toast/src/index.ts", import.meta.url),
      ),
      "@palladium/notifications-browser": fileURLToPath(
        new URL("../notifications-browser/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "@palladium/notifications-integration",
    environment: "happy-dom",
    include: ["src/__tests__/integration/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/index.ts"],
    },
  },
});
