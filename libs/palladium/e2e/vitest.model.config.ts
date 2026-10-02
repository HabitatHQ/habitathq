import { configDefaults, defineConfig } from "vitest/config";
import e2eConfig from "./vitest.config.js";

export default defineConfig({
  ...e2eConfig,
  test: {
    ...e2eConfig.test,
    include: ["src/__tests__/quint-delivery.test.ts"],
    exclude: configDefaults.exclude,
  },
});
