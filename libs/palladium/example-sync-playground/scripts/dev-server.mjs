#!/usr/bin/env node
// Build + run the palladium dev server in multi-tenant (bearer) mode, so the
// playground's per-device "workspace" selector maps to real tenant scopes.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildCli, PKG_DIR, pathWithCargo } from "./lib.mjs";

const PORT = process.env.PALLADIUM_PORT ?? "3000";
const env = { ...process.env, PATH: pathWithCargo() };

const binary = buildCli(env);
const dataDir = join(PKG_DIR, ".data");
mkdirSync(dataDir, { recursive: true });

process.stderr.write(`• starting server on http://localhost:${PORT} (--auth bearer)\n`);
const server = spawn(
  binary,
  ["--db", "sqlite:playground.db", "dev", "--port", PORT, "--auth", "bearer"],
  { cwd: dataDir, stdio: "inherit", env },
);

const forward = (sig) => () => server.kill(sig);
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));
server.on("exit", (code) => process.exit(code ?? 0));
