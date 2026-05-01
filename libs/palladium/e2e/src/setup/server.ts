/**
 * Vitest globalSetup: builds the Palladium binary, spawns it against a
 * temporary SQLite database, waits for readiness, and tears it down after
 * the test run.
 */

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../");
const BINARY = join(ROOT, "target", "debug", "palladium");

export const E2E_PORT = 13_742;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

let server: ChildProcess | undefined;
let tmpDir: string | undefined;

/** Poll `url` until it returns HTTP 200, or reject after `timeoutMs`. */
async function waitForReady(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

export async function setup(): Promise<void> {
  // Build the binary first (no-op if already up to date).
  execFileSync("cargo", ["build", "-p", "palladium-cli"], {
    cwd: ROOT,
    stdio: "inherit",
  });

  // Create isolated temp directory for this test run.
  tmpDir = await mkdtemp(join(tmpdir(), "palladium-e2e-"));

  // Use a relative DB path so SQLite resolves it inside tmpDir.
  server = spawn(BINARY, ["--db", "sqlite:test.db", "dev", "--port", String(E2E_PORT)], {
    cwd: tmpDir,
    stdio: "pipe",
  });

  server.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[palladium] ${chunk.toString()}`);
  });

  server.on("error", (err) => {
    throw new Error(`Failed to start palladium server: ${err.message}`);
  });

  await waitForReady(`${E2E_BASE_URL}/api-doc/openapi.json`);
}

export async function teardown(): Promise<void> {
  server?.kill("SIGTERM");
  server = undefined;
  if (tmpDir !== undefined) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
}
