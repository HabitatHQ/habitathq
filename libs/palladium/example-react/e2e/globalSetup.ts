/**
 * Playwright globalSetup: builds the Palladium binary, spawns it against a
 * fresh temporary SQLite database, and tears it down after the test run.
 *
 * The server runs on API_PORT (13743) — distinct from the Vitest e2e suite
 * which uses 13742, so both can coexist in local development.
 */

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test";
import { API_PORT } from "../playwright.config.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const BINARY = join(ROOT, "target", "debug", "palladium");

async function waitForReady(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise<void>((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

let server: ChildProcess | undefined;
let tmpDir: string | undefined;

// biome-ignore lint/style/noDefaultExport: required by Playwright globalSetup
export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  // Build binary (no-op if already up to date).
  execFileSync("cargo", ["build", "-p", "palladium-cli"], {
    cwd: ROOT,
    stdio: "inherit",
  });

  tmpDir = await mkdtemp(join(tmpdir(), "palladium-e2e-react-"));

  server = spawn(BINARY, ["--db", "sqlite:test.db", "dev", "--port", String(API_PORT)], {
    cwd: tmpDir,
    stdio: "pipe",
  });

  server.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[palladium] ${chunk.toString()}`);
  });

  server.on("error", (err: Error) => {
    throw new Error(`Failed to start palladium server: ${err.message}`);
  });

  // /v1/changes returns 200 with an empty array when the server is ready.
  await waitForReady(`http://localhost:${API_PORT}/v1/changes`);

  return async (): Promise<void> => {
    server?.kill("SIGTERM");
    server = undefined;
    if (tmpDir !== undefined) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  };
}
