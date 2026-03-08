import { URL, fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  build: { target: "esnext" },
  optimizeDeps: {
    // sqlite-wasm must not be pre-bundled — it manages its own WASM loading.
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  resolve: {
    alias: {
      // Resolve workspace packages from source so Vite can process them.
      "@palladium/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@palladium/vue": fileURLToPath(new URL("../vue/src/index.ts", import.meta.url)),
      "@palladium/sqlite-browser": fileURLToPath(
        new URL("../sqlite-browser/src/index.ts", import.meta.url),
      ),
    },
  },
});
