import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const WORKSPACE_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../../",
);

const STARTUP_POLL_MS = 50;
const STOP_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export interface ManagedServer {
  readonly baseUrl: string;
  readonly port: number;
  readonly output: () => string;
  crash(): Promise<void>;
  stop(): Promise<void>;
}

interface ServerExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

interface StartServerOptions {
  readonly name: string;
  readonly binary: string;
  readonly args: (port: number) => readonly string[];
  readonly cwd: string;
  readonly readinessPath: string;
  readonly port?: number;
  readonly readinessTimeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export function rustBinary(name: string): string {
  const configured = process.env["CARGO_TARGET_DIR"];
  const targetDir =
    configured === undefined
      ? resolve(WORKSPACE_ROOT, "target")
      : resolve(WORKSPACE_ROOT, configured);
  return resolve(targetDir, "debug", name);
}

export function buildRustPackage(packageName: string): void {
  execFileSync("cargo", ["build", "-p", packageName], {
    cwd: WORKSPACE_ROOT,
    stdio: "inherit",
  });
}

export async function allocatePort(): Promise<number> {
  const reservation = createServer();
  try {
    await new Promise<void>((resolveListening, rejectListening) => {
      reservation.once("error", rejectListening);
      reservation.listen(0, "127.0.0.1", resolveListening);
    });
    const address = reservation.address();
    if (address === null || typeof address === "string") {
      throw new Error("ephemeral TCP reservation did not expose a numeric port");
    }
    return address.port;
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      reservation.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
    });
  }
}

function appendOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString();
  return next.length <= MAX_OUTPUT_BYTES ? next : next.slice(-MAX_OUTPUT_BYTES);
}

function processExit(child: ChildProcess): Promise<ServerExit> {
  return new Promise<ServerExit>((resolveExit) => {
    let settled = false;
    const settle = (result: ServerExit): void => {
      if (settled) return;
      settled = true;
      resolveExit(result);
    };
    child.once("error", (error) => settle({ code: null, signal: null, error }));
    child.once("exit", (code, signal) => settle({ code, signal }));
  });
}

async function waitForReady(
  childExit: Promise<ServerExit>,
  url: string,
  output: () => string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = fetch(url).then(
      (response) => response.ok,
      () => false,
    );
    const outcome = await Promise.race([
      probe.then((ready) => ({ kind: "probe" as const, ready })),
      childExit.then((exit) => ({ kind: "exit" as const, exit })),
    ]);
    if (outcome.kind === "exit") {
      const reason =
        outcome.exit.error?.message ?? `exit ${outcome.exit.code ?? outcome.exit.signal}`;
      throw new Error(`server exited before readiness (${reason})\n${output()}`);
    }
    if (outcome.ready) return;
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(STARTUP_POLL_MS, remaining));
  }
  throw new Error(`server at ${url} was not ready within ${timeoutMs}ms\n${output()}`);
}

async function awaitExit(childExit: Promise<ServerExit>, timeoutMs: number): Promise<boolean> {
  const timedOut = Symbol("timed-out");
  return (await Promise.race([childExit, delay(timeoutMs, timedOut)])) !== timedOut;
}

export async function startServer(options: StartServerOptions): Promise<ManagedServer> {
  const port = options.port ?? (await allocatePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(options.binary, [...options.args(port)], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: "pipe",
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output = appendOutput(output, chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output = appendOutput(output, chunk);
  });
  const exit = processExit(child);
  let stopped = false;
  const terminate = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode !== null || child.signalCode !== null) {
      await exit;
      return;
    }
    child.kill(signal);
    if (await awaitExit(exit, STOP_TIMEOUT_MS)) return;
    if (signal !== "SIGKILL") {
      child.kill("SIGKILL");
      if (await awaitExit(exit, STOP_TIMEOUT_MS)) return;
    }
    throw new Error(`${options.name} did not exit after ${signal}\n${output}`);
  };
  const stop = (): Promise<void> => terminate("SIGTERM");
  const crash = (): Promise<void> => terminate("SIGKILL");

  try {
    await waitForReady(
      exit,
      `${baseUrl}${options.readinessPath}`,
      () => output,
      options.readinessTimeoutMs ?? 30_000,
    );
  } catch (error) {
    await stop();
    throw error;
  }

  return { baseUrl, port, output: () => output, crash, stop };
}
