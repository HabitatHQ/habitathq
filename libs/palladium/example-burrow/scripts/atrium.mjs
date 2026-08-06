#!/usr/bin/env node
// Build + run only the Atrium server (no Vite). Useful when you run the web UI
// separately with `pnpm dev`.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildAtrium, PKG_DIR, pathWithCargo } from "./lib.mjs";

const PORT = process.env.ATRIUM_PORT ?? "4000";
const env = { ...process.env, PATH: pathWithCargo() };

const binary = buildAtrium(env);
const dataDir = join(PKG_DIR, ".data");
mkdirSync(dataDir, { recursive: true });

process.stderr.write(`• atrium → http://localhost:${PORT}  (dev bearer identity)\n`);
const child = spawn(
  binary,
  ["--atrium-db", "sqlite:atrium.db", "--changes-db", "sqlite:atrium-changes.db", "--port", PORT],
  { stdio: "inherit", cwd: dataDir, env },
);
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
