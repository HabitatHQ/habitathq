import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test";
import { API_PORT } from "../playwright.config.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const configuredTarget = process.env["CARGO_TARGET_DIR"];
const TARGET_DIR =
  configuredTarget === undefined
    ? join(ROOT, "target")
    : isAbsolute(configuredTarget)
      ? configuredTarget
      : resolve(ROOT, configuredTarget);
const BINARY = join(TARGET_DIR, "debug", "palladium");

async function waitForReady(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The readiness endpoint is the synchronization point; retry until deadline.
    }
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Palladium backend at ${url} did not become ready within ${timeoutMs}ms`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveExited, rejectExited) => {
    const timeout = setTimeout(
      () => rejectExited(new Error("Palladium backend did not exit after SIGTERM")),
      5_000,
    );
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExited();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectExited(error);
    });
    if (!child.kill("SIGTERM")) {
      clearTimeout(timeout);
      rejectExited(new Error("Unable to send SIGTERM to Palladium backend"));
    }
  });
}

let server: ChildProcess | undefined;
let tmpDir: string | undefined;

// biome-ignore lint/style/noDefaultExport: required by Playwright globalSetup
export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  try {
    await access(BINARY, constants.X_OK);
  } catch {
    throw new Error(
      `Missing Palladium backend binary at ${BINARY}. Build it first with: cargo build -p palladium-cli`,
    );
  }

  tmpDir = await mkdtemp(join(tmpdir(), "palladium-e2e-react-"));
  const startedServer = spawn(
    BINARY,
    ["--db", "sqlite:test.db", "dev", "--port", String(API_PORT)],
    {
      cwd: tmpDir,
      stdio: "pipe",
    },
  );
  server = startedServer;
  startedServer.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[palladium] ${chunk.toString()}`);
  });
  const startupError = new Promise<never>((_resolve, reject) => {
    startedServer.once("error", reject);
  });

  try {
    await Promise.race([waitForReady(`http://localhost:${API_PORT}/v1/changes`), startupError]);
  } catch (error) {
    try {
      await stopServer(startedServer);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
      server = undefined;
      tmpDir = undefined;
    }
    throw error;
  }

  return async (): Promise<void> => {
    if (server !== undefined) {
      await stopServer(server);
      server = undefined;
    }
    if (tmpDir !== undefined) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  };
}
