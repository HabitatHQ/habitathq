import { randomUUID } from "node:crypto";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";

const SYNC_TIMEOUT = 15_000;

type Instance = {
  readonly context: BrowserContext;
  readonly database: string;
  readonly nodeId: string;
  page: Page;
};

function isUuidV7(value: string | null): boolean {
  return (
    value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

async function openInstance(
  browser: Browser,
  database = randomUUID(),
  nodeId = randomUUID(),
): Promise<Instance> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/?database=${database}&node=${nodeId}`);
  await expect(page.getByTestId("notes-list")).toBeVisible();
  await expect(page.getByTestId("node-id")).toHaveText(nodeId);
  return { context, database, nodeId, page };
}

async function reopen(instance: Instance): Promise<void> {
  instance.page = await instance.context.newPage();
  await instance.page.goto(`/?database=${instance.database}&node=${instance.nodeId}`);
  await expect(instance.page.getByTestId("notes-list")).toBeVisible();
  await expect(instance.page.getByTestId("node-id")).toHaveText(instance.nodeId);
}

async function pendingCount(page: Page): Promise<number> {
  return Number(await page.getByTestId("pending-outbox-count").textContent());
}

test.describe("OPFS-backed v1 sync recovery", () => {
  test("offline outbox survives abrupt tab termination, then converges through the Rust backend", async ({
    browser,
  }) => {
    const writer = await openInstance(browser);
    const reader = await openInstance(browser);
    const title = `offline recovery ${randomUUID()}`;

    try {
      await writer.context.setOffline(true);
      await writer.page.getByTestId("new-note-btn").click();
      await writer.page.getByTestId("note-title").fill(title);

      const writerNote = writer.page.getByTestId("note-item").filter({ hasText: title });
      await expect(writerNote).toBeVisible();
      expect(isUuidV7(await writerNote.getAttribute("data-row-id"))).toBe(true);
      await expect.poll(() => pendingCount(writer.page)).toBeGreaterThan(0);

      // Closing the tab terminates its dedicated worker without calling the service's disposal path.
      await writer.page.close();
      await writer.context.setOffline(false);
      await reopen(writer);

      // The reopened owner reads the same OPFS store before transport recovery drains its durable outbox.
      await expect(writer.page.getByTestId("note-item").filter({ hasText: title })).toBeVisible({
        timeout: SYNC_TIMEOUT,
      });
      await expect.poll(() => pendingCount(writer.page), { timeout: SYNC_TIMEOUT }).toBe(0);

      await expect(reader.page.getByTestId("note-item").filter({ hasText: title })).toBeVisible({
        timeout: SYNC_TIMEOUT,
      });
    } finally {
      await writer.context.close();
      await reader.context.close();
    }
  });

  test("reload reopens the same OPFS database with its v1 row and node identities", async ({
    browser,
  }) => {
    const writer = await openInstance(browser);
    const reader = await openInstance(browser);
    const title = `reload recovery ${randomUUID()}`;

    try {
      await writer.page.getByTestId("new-note-btn").click();
      await writer.page.getByTestId("note-title").fill(title);

      const writerNote = writer.page.getByTestId("note-item").filter({ hasText: title });
      await expect(writerNote).toBeVisible();
      const rowId = await writerNote.getAttribute("data-row-id");
      expect(isUuidV7(rowId)).toBe(true);

      await expect(reader.page.getByTestId("note-item").filter({ hasText: title })).toBeVisible({
        timeout: SYNC_TIMEOUT,
      });
      await expect.poll(() => pendingCount(writer.page), { timeout: SYNC_TIMEOUT }).toBe(0);

      await writer.page.reload();
      await expect(writer.page.getByTestId("node-id")).toHaveText(writer.nodeId);
      const reloadedNote = writer.page.getByTestId("note-item").filter({ hasText: title });
      await expect(reloadedNote).toBeVisible({ timeout: SYNC_TIMEOUT });
      expect(await reloadedNote.getAttribute("data-row-id")).toBe(rowId);
    } finally {
      await writer.context.close();
      await reader.context.close();
    }
  });

  test("note created in one v1 client appears in another", async ({ browser }) => {
    const writer = await openInstance(browser);
    const reader = await openInstance(browser);
    const title = `created in writer ${randomUUID()}`;

    try {
      await writer.page.getByTestId("new-note-btn").click();
      await writer.page.getByTestId("note-title").fill(title);
      await expect(reader.page.getByTestId("note-item").filter({ hasText: title })).toBeVisible({
        timeout: SYNC_TIMEOUT,
      });
    } finally {
      await writer.context.close();
      await reader.context.close();
    }
  });

  test("title edits propagate to another v1 client", async ({ browser }) => {
    const writer = await openInstance(browser);
    const reader = await openInstance(browser);
    const initialTitle = `initial title ${randomUUID()}`;
    const updatedTitle = `updated title ${randomUUID()}`;

    try {
      await writer.page.getByTestId("new-note-btn").click();
      await writer.page.getByTestId("note-title").fill(initialTitle);
      await expect(
        reader.page.getByTestId("note-item").filter({ hasText: initialTitle }),
      ).toBeVisible({
        timeout: SYNC_TIMEOUT,
      });

      await writer.page.getByTestId("note-title").fill(updatedTitle);
      await expect(
        reader.page.getByTestId("note-item").filter({ hasText: updatedTitle }),
      ).toBeVisible({
        timeout: SYNC_TIMEOUT,
      });
    } finally {
      await writer.context.close();
      await reader.context.close();
    }
  });

  test("rich text typed in one v1 client is available from another", async ({ browser }) => {
    const writer = await openInstance(browser);
    const reader = await openInstance(browser);
    const title = `rich text ${randomUUID()}`;
    const body = `paragraph ${randomUUID()}`;

    try {
      await writer.page.getByTestId("new-note-btn").click();
      await writer.page.getByTestId("note-title").fill(title);
      await writer.page.getByTestId("editor-content").locator("[contenteditable]").click();
      await writer.page.keyboard.type(body);
      await expect(
        writer.page.getByTestId("editor-content").locator("[contenteditable]"),
      ).toHaveText(body);

      const readerNote = reader.page.getByTestId("note-item").filter({ hasText: title });
      await expect(readerNote).toBeVisible({ timeout: SYNC_TIMEOUT });
      await readerNote.click();
      await expect(
        reader.page.getByTestId("editor-content").locator("[contenteditable]"),
      ).toHaveText(body, { timeout: SYNC_TIMEOUT });
    } finally {
      await writer.context.close();
      await reader.context.close();
    }
  });

  test("two v1 clients accept concurrent notes bidirectionally", async ({ browser }) => {
    const first = await openInstance(browser);
    const second = await openInstance(browser);
    const firstTitle = `first client ${randomUUID()}`;
    const secondTitle = `second client ${randomUUID()}`;

    try {
      await first.page.getByTestId("new-note-btn").click();
      await first.page.getByTestId("note-title").fill(firstTitle);
      await second.page.getByTestId("new-note-btn").click();
      await second.page.getByTestId("note-title").fill(secondTitle);

      await expect(
        first.page.getByTestId("note-item").filter({ hasText: secondTitle }),
      ).toBeVisible({
        timeout: SYNC_TIMEOUT,
      });
      await expect(
        second.page.getByTestId("note-item").filter({ hasText: firstTitle }),
      ).toBeVisible({
        timeout: SYNC_TIMEOUT,
      });
    } finally {
      await first.context.close();
      await second.context.close();
    }
  });

  test("delete from one v1 client removes the note from another", async ({ browser }) => {
    const writer = await openInstance(browser);
    const reader = await openInstance(browser);
    const title = `deleted note ${randomUUID()}`;

    try {
      await writer.page.getByTestId("new-note-btn").click();
      await writer.page.getByTestId("note-title").fill(title);
      const readerNote = reader.page.getByTestId("note-item").filter({ hasText: title });
      await expect(readerNote).toBeVisible({ timeout: SYNC_TIMEOUT });

      await writer.page
        .getByTestId("note-item")
        .filter({ hasText: title })
        .getByTestId("delete-note-btn")
        .click();
      await expect(readerNote).not.toBeVisible({ timeout: SYNC_TIMEOUT });
    } finally {
      await writer.context.close();
      await reader.context.close();
    }
  });

  test("reload preserves notes hydrated from the Rust backend", async ({ browser }) => {
    const writer = await openInstance(browser);
    const reloader = await openInstance(browser);
    const title = `server hydration ${randomUUID()}`;

    try {
      await writer.page.getByTestId("new-note-btn").click();
      await writer.page.getByTestId("note-title").fill(title);
      await expect(reloader.page.getByTestId("note-item").filter({ hasText: title })).toBeVisible({
        timeout: SYNC_TIMEOUT,
      });

      await reloader.page.reload();
      await expect(reloader.page.getByTestId("node-id")).toHaveText(reloader.nodeId);
      await expect(reloader.page.getByTestId("note-item").filter({ hasText: title })).toBeVisible({
        timeout: SYNC_TIMEOUT,
      });
    } finally {
      await writer.context.close();
      await reloader.context.close();
    }
  });
});
