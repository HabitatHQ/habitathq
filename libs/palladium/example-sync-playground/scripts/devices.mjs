#!/usr/bin/env node
// Run ONE device per port: builds + starts the Rust sync server, then spawns
// N Vite dev servers on consecutive ports (5173, 5174, …), each rendering a
// single device in `?single` mode. Open each URL in its own window to simulate
// separate devices that all sync through the same server. Ctrl-C tears down all.
//
//   node scripts/devices.mjs [count]     (default 2)
//   pnpm --filter @palladium/example-sync-playground devices 3
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildCli, PKG_DIR, pathWithCargo } from "./lib.mjs";

const PORT = process.env.PALLADIUM_PORT ?? "3000";
const BASE_VITE_PORT = Number(process.env.VITE_BASE_PORT ?? "5173");
const count = Math.max(1, Math.min(8, Number(process.argv[2] ?? "2") || 2));
const env = { ...process.env, PATH: pathWithCargo() };

const binary = buildCli(env);
const dataDir = join(PKG_DIR, ".data");
mkdirSync(dataDir, { recursive: true });

const children = [];
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function run(label, cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: "inherit", ...opts });
  child.on("exit", (code) => {
    process.stderr.write(`• ${label} exited (${code ?? 0}); shutting down.\n`);
    shutdown();
  });
  children.push(child);
}

process.stderr.write(`• sync server → http://localhost:${PORT}  (bearer auth)\n`);
run("server", binary, ["--db", "sqlite:playground.db", "dev", "--port", PORT, "--auth", "bearer"], {
  cwd: dataDir,
  env,
});

process.stderr.write(`• launching ${count} single-device windows:\n`);
for (let i = 0; i < count; i++) {
  const vitePort = BASE_VITE_PORT + i;
  process.stderr.write(`    device ${i + 1} → http://localhost:${vitePort}/?single\n`);
  run(`vite:${vitePort}`, "pnpm", ["exec", "vite", "--port", String(vitePort), "--strictPort"], {
    cwd: PKG_DIR,
    env,
  });
}
