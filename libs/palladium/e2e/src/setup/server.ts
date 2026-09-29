/**
 * Vitest globalSetup: builds the Palladium binary, spawns it against a
 * temporary SQLite database, waits for readiness, and tears it down after
 * the test run.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRustPackage, type ManagedServer, rustBinary, startServer } from "./process.js";

export const E2E_BASE_URL_CONTEXT_KEY = "palladiumE2eBaseUrl";

let server: ManagedServer | undefined;
let tmpDir: string | undefined;

export async function setup({
  provide,
}: {
  readonly provide: (key: string, value: string) => void;
}): Promise<void> {
  buildRustPackage("palladium-cli");
  tmpDir = await mkdtemp(join(tmpdir(), "palladium-e2e-"));
  try {
    server = await startServer({
      name: "palladium",
      binary: rustBinary("palladium"),
      args: (port) => ["--db", "sqlite:test.db", "dev", "--port", String(port)],
      cwd: tmpDir,
      readinessPath: "/api-doc/openapi.json",
    });
    provide(E2E_BASE_URL_CONTEXT_KEY, server.baseUrl);
  } catch (error) {
    await teardown();
    throw error;
  }
}

export async function teardown(): Promise<void> {
  if (server !== undefined) {
    await server.stop();
    server = undefined;
  }
  if (tmpDir !== undefined) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
}
