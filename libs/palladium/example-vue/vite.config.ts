import { URL, fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  build: { target: "esnext" },
  resolve: {
    alias: {
      // Resolve workspace packages from source so Vite can process them.
      "@palladium/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@palladium/vue": fileURLToPath(new URL("../vue/src/index.ts", import.meta.url)),
      // Stub out node:module so SqliteAdapter's class definition loads safely in
      // the browser — DatabaseSync will be undefined, but we only use MemoryAdapter.
      "node:module": fileURLToPath(new URL("./src/stubs/node-module.ts", import.meta.url)),
    },
  },
});
