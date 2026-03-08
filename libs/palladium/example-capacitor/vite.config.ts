import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // Use relative base so the built HTML works when loaded via file:// in Electron.
  base: "./",
  build: {
    target: "esnext",
    outDir: "dist",
  },
  resolve: {
    alias: {
      // Redirect the Capacitor SQLite import to our Electron shim so the
      // renderer bundle never tries to load the real native plugin.
      "@capacitor-community/sqlite": fileURLToPath(
        new URL("./src/shim/capacitor-sqlite.ts", import.meta.url),
      ),
      "@palladium/sqlite-capacitor": fileURLToPath(
        new URL("../sqlite-capacitor/src/index.ts", import.meta.url),
      ),
      "@palladium/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
});
