#!/usr/bin/env node
/**
 * palladium-cli — npm shim for the Rust CLI binary.
 *
 * Resolves the platform-specific binary (e.g. `palladium-linux-x64`) from
 * an optional sibling package, then execs it with the user's arguments.
 * Falls back to a helpful error message if no binary is found.
 *
 * Binary packages follow the naming convention:
 *   palladium-<platform>-<arch>
 * where platform is one of: linux, darwin, win32
 * and arch is one of: x64, arm64
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const SUPPORTED = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

function resolveBinary(): string {
  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;

  if (!SUPPORTED.includes(target)) {
    throw new Error(`Unsupported platform: ${target}. Supported: ${SUPPORTED.join(", ")}`);
  }

  const binaryName = platform === "win32" ? "palladium.exe" : "palladium";
  const packageName = `palladium-${target}`;

  const require = createRequire(import.meta.url);
  let packageDir: string;
  try {
    packageDir = join(require.resolve(`${packageName}/package.json`), "..");
  } catch {
    throw new Error(
      `Could not find binary package "${packageName}". ` +
        `Install it with: npm install ${packageName}`,
    );
  }

  const binaryPath = join(packageDir, "bin", binaryName);
  if (!existsSync(binaryPath)) {
    throw new Error(`Binary not found at: ${binaryPath}`);
  }

  return binaryPath;
}

try {
  const binary = resolveBinary();
  execFileSync(binary, process.argv.slice(2), { stdio: "inherit" });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`palladium: ${message}\n`);
  process.exit(1);
}
