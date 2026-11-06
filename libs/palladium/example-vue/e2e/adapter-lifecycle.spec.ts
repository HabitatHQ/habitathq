import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("browser SQLite orders overlapping open and close without losing the active database", async ({
  page,
}) => {
  await page.goto("/");
  const moduleUrl = `/@fs${fileURLToPath(new URL("../../sqlite-browser/src/adapter.ts", import.meta.url))}`;
  const result = await page.evaluate(async (url) => {
    // Load through Vite inside Chromium; a static import runs in Playwright's Node process.
    const { BrowserSqliteAdapter } = await import(url);
    const adapter = new BrowserSqliteAdapter({ vfs: { type: "memory" } });
    const opening = adapter.open();
    const closing = adapter.close();
    await Promise.all([opening, closing]);
    let closed = false;
    try {
      await adapter.exec("SELECT 1");
    } catch {
      closed = true;
    }
    await Promise.all([adapter.open(), adapter.open()]);
    await adapter.exec("CREATE TABLE retained (id INTEGER PRIMARY KEY, value TEXT)");
    await adapter.exec("INSERT INTO retained VALUES (1, 'kept')");
    await Promise.all([adapter.open(), adapter.open()]);
    const rows = await adapter.exec("SELECT * FROM retained");
    const closeAgain = adapter.close();
    const reopen = adapter.open();
    await Promise.all([closeAgain, reopen]);
    const freshTables = await adapter.exec(
      "SELECT name FROM sqlite_master WHERE name = 'retained'",
    );
    await adapter.close();
    return { closed, rows, freshTables };
  }, moduleUrl);
  expect(result).toEqual({ closed: true, rows: [{ id: 1, value: "kept" }], freshTables: [] });
});
