/**
 * E2E sync tests — two browser instances of the React notes app communicating
 * through a live Palladium backend.
 *
 * Topology:
 *
 *   Page A (node = alice-uuid)  ─── POST /v1/changes ──►  Palladium backend
 *   Page B (node = bob-uuid)    ─── GET  /v1/changes ──►  (SQLite store)
 *
 * Each test opens two independent browser contexts so that storage, memory,
 * and React state are fully isolated between instances.  A 3-second settle
 * window covers the 1-second poll interval plus debounce and processing time.
 *
 * Node IDs are zero-padded UUIDs for readable test output.
 */

import { type Browser, type Page, expect, test } from "@playwright/test";

const ALICE = "00000000-0000-0000-0000-000000000001";
const BOB = "00000000-0000-0000-0000-000000000002";

/** How long to wait for a change to propagate from one instance to another. */
const SYNC_TIMEOUT = 5_000;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function openInstance(browser: Browser, nodeId: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/?node=${nodeId}`);
  // Wait until the notes list is rendered (app has finished init + first render).
  await page.waitForSelector('[data-testid="notes-list"]');
  return page;
}

/** Unique suffix per test run so concurrent / repeated runs don't collide. */
function uid(): string {
  return Math.random().toString(36).slice(2, 7);
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("two-instance sync", () => {
  test("note created in A appears in B's list", async ({ browser }) => {
    const pageA = await openInstance(browser, ALICE);
    const pageB = await openInstance(browser, BOB);

    const title = `Hello from Alice ${uid()}`;

    // Create a note in page A.
    await pageA.getByTestId("new-note-btn").click();
    await pageA.getByTestId("note-title").fill(title);

    // Wait for the title update to propagate to the server and then to page B.
    await expect(pageB.getByTestId("note-item").filter({ hasText: title })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    await pageA.context().close();
    await pageB.context().close();
  });

  test("note title edited in A updates in B's sidebar", async ({ browser }) => {
    const pageA = await openInstance(browser, ALICE);
    const pageB = await openInstance(browser, BOB);

    const initial = `Initial ${uid()}`;
    const updated = `Updated ${uid()}`;

    // Create note in A with initial title.
    await pageA.getByTestId("new-note-btn").click();
    await pageA.getByTestId("note-title").fill(initial);

    // Confirm note exists in B.
    await expect(pageB.getByTestId("note-item").filter({ hasText: initial })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    // Update the title in A.
    await pageA.getByTestId("note-title").fill(updated);

    // Verify B reflects the new title.
    await expect(pageB.getByTestId("note-item").filter({ hasText: updated })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    await pageA.context().close();
    await pageB.context().close();
  });

  test("rich-text content typed in A appears in B's editor", async ({ browser }) => {
    const pageA = await openInstance(browser, ALICE);
    const pageB = await openInstance(browser, BOB);

    const title = `Content sync ${uid()}`;
    const body = `Paragraph from Alice ${uid()}`;

    // Create note in A.
    await pageA.getByTestId("new-note-btn").click();
    await pageA.getByTestId("note-title").fill(title);

    // Type body text into the TipTap editor.
    await pageA.getByTestId("editor-content").locator("[contenteditable]").click();
    await pageA.keyboard.type(body);

    // Wait for note to appear in B's list, then open it.
    const noteBItem = pageB.getByTestId("note-item").filter({ hasText: title });
    await expect(noteBItem).toBeVisible({ timeout: SYNC_TIMEOUT });
    await noteBItem.click();

    // B's editor should contain the typed text.
    await expect(pageB.getByTestId("editor-content").locator("[contenteditable]")).toContainText(
      body,
      { timeout: SYNC_TIMEOUT },
    );

    await pageA.context().close();
    await pageB.context().close();
  });

  test("note created in B appears in A's list (bidirectional)", async ({ browser }) => {
    const pageA = await openInstance(browser, ALICE);
    const pageB = await openInstance(browser, BOB);

    const titleFromA = `From Alice ${uid()}`;
    const titleFromB = `From Bob ${uid()}`;

    // A creates a note.
    await pageA.getByTestId("new-note-btn").click();
    await pageA.getByTestId("note-title").fill(titleFromA);

    // B creates a note concurrently.
    await pageB.getByTestId("new-note-btn").click();
    await pageB.getByTestId("note-title").fill(titleFromB);

    // Both notes should eventually appear in both lists.
    await expect(pageA.getByTestId("note-item").filter({ hasText: titleFromB })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    await expect(pageB.getByTestId("note-item").filter({ hasText: titleFromA })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    await pageA.context().close();
    await pageB.context().close();
  });

  test("note deleted in A disappears from B's list", async ({ browser }) => {
    const pageA = await openInstance(browser, ALICE);
    const pageB = await openInstance(browser, BOB);

    const title = `To be deleted ${uid()}`;

    // Create note in A.
    await pageA.getByTestId("new-note-btn").click();
    await pageA.getByTestId("note-title").fill(title);

    // Confirm it appears in B.
    await expect(pageB.getByTestId("note-item").filter({ hasText: title })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    // Delete it in A.
    await pageA
      .getByTestId("note-item")
      .filter({ hasText: title })
      .getByTestId("delete-note-btn")
      .click();

    // Confirm it disappears from B.
    await expect(pageB.getByTestId("note-item").filter({ hasText: title })).not.toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    await pageA.context().close();
    await pageB.context().close();
  });

  test("page reload hydrates notes from server", async ({ browser }) => {
    const pageA = await openInstance(browser, ALICE);

    const title = `Persisted ${uid()}`;

    // Create note.
    await pageA.getByTestId("new-note-btn").click();
    await pageA.getByTestId("note-title").fill(title);
    await pageA.waitForTimeout(1_500); // let the write reach the server

    // Reload the page — memory is cleared, state must be rebuilt from server.
    await pageA.reload();
    await pageA.waitForSelector('[data-testid="notes-list"]');

    await expect(pageA.getByTestId("note-item").filter({ hasText: title })).toBeVisible({
      timeout: SYNC_TIMEOUT,
    });

    await pageA.context().close();
  });
});
