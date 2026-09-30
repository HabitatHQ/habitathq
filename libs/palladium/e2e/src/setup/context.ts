import { inject } from "vitest";
import { E2E_BASE_URL_CONTEXT_KEY } from "./server.js";

declare module "vitest" {
  interface ProvidedContext {
    palladiumE2eBaseUrl: string;
  }
}

export function e2eBaseUrl(): string {
  return inject(E2E_BASE_URL_CONTEXT_KEY);
}
