#!/usr/bin/env node
// One command to run the whole playground: builds + starts the Rust sync
// server AND the Vite dev server, wiring both to the same terminal. Ctrl-C
// tears everything down.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildCli, PKG_DIR, pathWithCargo } from "./lib.mjs";

const PORT = process.env.PALLADIUM_PORT ?? "3000";
const env = { ...process.env, PATH: pathWithCargo() };

const binary = buildCli(env);
const dataDir = join(PKG_DIR, ".data");
mkdirSync(dataDir, { recursive: true });

const children = [];
function run(label, cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: "inherit", ...opts });
  child.on("exit", (code) => {
    process.stderr.write(`• ${label} exited (${code ?? 0}); shutting down.\n`);
    shutdown();
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.stderr.write(`• sync server → http://localhost:${PORT}  (bearer auth)\n`);
run("server", binary, ["--db", "sqlite:playground.db", "dev", "--port", PORT, "--auth", "bearer"], {
  cwd: dataDir,
  env,
});

process.stderr.write("• web UI → http://localhost:5173  (opens the playground)\n");
run("vite", "pnpm", ["exec", "vite"], { cwd: PKG_DIR, env });
