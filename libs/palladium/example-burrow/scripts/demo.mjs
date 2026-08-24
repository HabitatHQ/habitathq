#!/usr/bin/env node
// One command to run the whole burrow demo: builds + starts the Atrium server
// AND the Vite dev server. Open two tabs (?user=alice and ?user=bob) to play
// both sides of a family. Ctrl-C tears everything down.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildAtrium, PKG_DIR, pathWithCargo } from "./lib.mjs";

const PORT = process.env.ATRIUM_PORT ?? "4000";
const env = { ...process.env, PATH: pathWithCargo() };

const binary = buildAtrium(env);
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

process.stderr.write(`• atrium → http://localhost:${PORT}  (dev bearer identity)\n`);
run(
  "atrium",
  binary,
  ["--atrium-db", "sqlite:atrium.db", "--changes-db", "sqlite:atrium-changes.db", "--port", PORT],
  { cwd: dataDir, env },
);

process.stderr.write("• web UI → http://localhost:5173  (open ?user=alice and ?user=bob)\n");
run("vite", "pnpm", ["exec", "vite"], { cwd: PKG_DIR, env });
