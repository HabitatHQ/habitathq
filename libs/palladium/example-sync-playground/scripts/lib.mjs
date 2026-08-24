// Shared helpers for the playground launcher scripts.
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

/** Build the palladium CLI once; return the path to the built binary. */
export function buildCli(env) {
  process.stderr.write("• building palladium-cli (first run compiles Rust — hang tight)…\n");
  const res = spawnSync("cargo", ["build", "-p", "palladium-cli"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env,
  });
  if (res.status !== 0) {
    throw new Error(
      "cargo build failed. Is Rust installed? (https://rustup.rs). " +
        "If cargo is installed but not found, this script already adds ~/.cargo/bin and " +
        "~/.rustup/toolchains/*/bin to PATH — check `rustup show`.",
    );
  }
  return join(REPO_ROOT, "target", "debug", "palladium");
}
