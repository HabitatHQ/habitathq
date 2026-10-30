import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

test("SAH pool close releases handles and preserves data while the old worker stays alive", async ({
  page,
}) => {
  await page.goto("/");
  const adapterModuleUrl = new URL(
    `/@fs${fileURLToPath(new URL("../../sqlite-browser/src/index.ts", import.meta.url))}`,
    page.url(),
  ).href;
  const directory = `/lifecycle-${crypto.randomUUID()}`;

  const results = await page.evaluate(
    async ({ adapterModuleUrl, directory }) => {
      const workerSource = `
        import { BrowserSqliteAdapter } from ${JSON.stringify(adapterModuleUrl)};
        const adapter = new BrowserSqliteAdapter({
          vfs: { type: "opfs-sah-pool", directory: ${JSON.stringify(directory)}, filename: "/probe.db" }
        });
        const withLock = (callback) => navigator.locks.request("lifecycle-probe", callback);
        self.onmessage = async ({ data: { id, action } }) => {
          try {
            await withLock(async () => {
              if (action === "seed-close") {
                await adapter.open();
                await adapter.exec("CREATE TABLE IF NOT EXISTS probe (value TEXT NOT NULL)");
                await adapter.exec("INSERT INTO probe VALUES ('durable')");
                await adapter.close();
                self.postMessage({ id, ok: true });
              } else if (action === "reopen-close") {
                await adapter.open();
                const rows = await adapter.exec("SELECT value FROM probe");
                await adapter.close();
                self.postMessage({ id, rows });
              } else if (action === "failed-start-close") {
                await adapter.open();
                try {
                  throw new Error("injected schema failure");
                } catch {
                  await adapter.close();
                }
                self.postMessage({ id, ok: true });
              } else if (action === "read-close") {
                await adapter.open();
                const rows = await adapter.exec("SELECT value FROM probe");
                await adapter.close();
                self.postMessage({ id, rows });
              } else if (action === "reset") {
                await adapter.open();
                await adapter.resetStorage();
                const rows = await adapter.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'probe'");
                await adapter.close();
                self.postMessage({ id, rows });
              } else if (action === "ping") {
                self.postMessage({ id, alive: true });
              } else {
                self.postMessage({ id, ok: true });
              }
            });
          } catch (error) {
            self.postMessage({ id, error: String(error) });
          }
        };
      `;
      const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
      const first = new Worker(workerUrl, { type: "module" });
      const second = new Worker(workerUrl, { type: "module" });
      let nextId = 0;

      const request = (worker: Worker, action: string) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const id = ++nextId;
          const onMessage = (event: MessageEvent<Record<string, unknown>>) => {
            if (event.data["id"] !== id) return;
            worker.removeEventListener("message", onMessage);
            if (event.data["error"]) reject(new Error(String(event.data["error"])));
            else resolve(event.data);
          };
          worker.addEventListener("message", onMessage);
          worker.postMessage({ id, action });
        });

      try {
        await request(first, "seed-close");
        const reopened = await request(first, "reopen-close");
        const afterClose = await request(second, "read-close");
        const alive = await request(first, "ping");
        await request(first, "failed-start-close");
        const afterFailedStart = await request(second, "read-close");
        const reset = await request(second, "reset");
        return { reopened, afterClose, alive, afterFailedStart, reset };
      } finally {
        first.terminate();
        second.terminate();
        URL.revokeObjectURL(workerUrl);
      }
    },
    { adapterModuleUrl, directory },
  );

  expect(results["reopened"]).toEqual({ id: 2, rows: [{ value: "durable" }] });
  expect(results["afterClose"]).toEqual({ id: 3, rows: [{ value: "durable" }] });
  expect(results["alive"]).toEqual({ id: 4, alive: true });
  expect(results["afterFailedStart"]).toEqual({ id: 6, rows: [{ value: "durable" }] });
  expect(results["reset"]).toEqual({ id: 7, rows: [] });
});
const roleOf = (page: Page) => page.locator("#role");
const notes = (page: Page) => page.locator("#list li");

function isUuidV7(value: string | null): boolean {
  return (
    value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

async function addNote(page: Page, body: string): Promise<void> {
  await page.locator("#body").fill(body);
  await page.locator("#add").click();
}

async function waitRole(page: Page, role: "leader" | "follower"): Promise<void> {
  await expect(roleOf(page)).toHaveAttribute("data-role", role, { timeout: 15_000 });
}

test.describe("OPFS worker ownership", () => {
  test("single owner, live cross-tab propagation, seamless close failover", async ({ browser }) => {
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();

    try {
      await first.goto("/");
      await waitRole(first, "leader");
      await first.locator("#clear").click();
      await expect(notes(first)).toHaveCount(0);

      await second.goto("/");
      await waitRole(second, "follower");
      await addNote(first, "from first");
      await expect(notes(second)).toHaveText(["from first"]);
      expect(isUuidV7(await notes(first).first().getAttribute("data-id"))).toBe(true);

      await addNote(second, "from second");
      await expect(notes(first)).toHaveText(["from second", "from first"]);

      await first.close();
      await waitRole(second, "leader");
      await expect(notes(second)).toHaveText(["from second", "from first"]);

      await addNote(second, "after close failover");
      await expect(notes(second)).toHaveText(["after close failover", "from second", "from first"]);
    } finally {
      await context.close();
    }
  });

  test("interrupted leader reload preserves committed OPFS data and hands writes to the waiting follower", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const owner = await context.newPage();
    const follower = await context.newPage();

    try {
      await owner.goto("/");
      await waitRole(owner, "leader");
      await owner.locator("#clear").click();
      await expect(notes(owner)).toHaveCount(0);

      await follower.goto("/");
      await waitRole(follower, "follower");
      await addNote(owner, "committed before owner reload");
      await expect(notes(follower)).toHaveText(["committed before owner reload"]);

      // Reload terminates the leader's dedicated worker. The already-waiting follower must own OPFS next.
      await owner.reload();
      await waitRole(follower, "leader");
      await waitRole(owner, "follower");
      await expect(notes(follower)).toHaveText(["committed before owner reload"]);
      await expect(notes(owner)).toHaveText(["committed before owner reload"]);

      await addNote(follower, "written after owner reload");
      await expect(notes(owner)).toHaveText([
        "written after owner reload",
        "committed before owner reload",
      ]);
    } finally {
      await context.close();
    }
  });
});
