// Shared helpers for the burrow launcher scripts.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = join(HERE, "..");
export const REPO_ROOT = join(PKG_DIR, "..", "..", "..");

/**
 * Return a PATH that includes cargo, even when the shell profile doesn't.
 * Adds `~/.cargo/bin` and every `~/.rustup/toolchains/<tc>/bin` we can find.
 */
export function pathWithCargo() {
  const extra = [join(homedir(), ".cargo", "bin")];
  const toolchains = join(homedir(), ".rustup", "toolchains");
  if (existsSync(toolchains)) {
    for (const tc of readdirSync(toolchains)) extra.push(join(toolchains, tc, "bin"));
  }
  const current = process.env.PATH ?? "";
  return [...extra, current].filter(Boolean).join(":");
}

/** Build the Atrium server once; return the path to the built binary. */
export function buildAtrium(env) {
  process.stderr.write("• building atrium (first run compiles Rust — hang tight)…\n");
  const res = spawnSync("cargo", ["build", "-p", "atrium"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env,
  });
  if (res.status !== 0) {
    throw new Error(
      "cargo build failed. Is Rust installed? (https://rustup.rs). " +
        "This script already adds ~/.cargo/bin and ~/.rustup/toolchains/*/bin to PATH.",
    );
  }
  return join(REPO_ROOT, "target", "debug", "atrium");
}
