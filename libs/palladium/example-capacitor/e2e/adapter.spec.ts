/**
 * Playwright Electron smoke tests for CapacitorSqliteAdapter.
 *
 * Launches the Electron app (main process: electron/dist/index.js, renderer:
 * dist/index.html), waits for the renderer to finish running its self-contained
 * test suite, then asserts that all tests passed.
 *
 * Run via:  just test-capacitor
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_MAIN = path.join(__dirname, "../electron/dist/index.js");

test("CapacitorSqliteAdapter CRUD operations pass in Electron", async () => {
  const app = await electron.launch({ args: [ELECTRON_MAIN] });

  // Forward main-process stdout/stderr so CI logs show what's happening.
  app
    .process()
    .stdout?.on("data", (d: Buffer) => process.stdout.write(`[electron-main] ${d.toString()}`));
  app
    .process()
    .stderr?.on("data", (d: Buffer) => process.stderr.write(`[electron-main-err] ${d.toString()}`));

  try {
    const page = await app.firstWindow();

    // Forward renderer console messages.
    page.on("console", (msg) => {
      process.stdout.write(`[renderer:${msg.type()}] ${msg.text()}\n`);
    });

    // Wait until the renderer test runner has finished (sets data-status on body).
    await page.waitForSelector("body[data-status]", { timeout: 20_000 });

    const bodyStatus = await page.getAttribute("body", "data-status");
    const bodyError = await page.getAttribute("body", "data-error");

    // Collect per-test failures for a helpful error message.
    const failedItems = await page.locator("li[data-status='failed']").all();
    const failureLines = await Promise.all(
      failedItems.map(async (el) => {
        const name = (await el.textContent()) ?? "(unknown)";
        const error = (await el.getAttribute("data-error")) ?? "";
        return `  • ${name}: ${error}`;
      }),
    );

    if (failureLines.length > 0 || bodyStatus !== "done") {
      const detail =
        bodyError !== null
          ? `\nFatal error: ${bodyError}`
          : `\nFailed tests:\n${failureLines.join("\n")}`;
      throw new Error(`Adapter smoke tests did not all pass.${detail}`);
    }

    expect(failureLines).toHaveLength(0);
    expect(bodyStatus).toBe("done");
  } finally {
    await app.close();
  }
});
