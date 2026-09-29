import { expect, type Page, test } from "@playwright/test";

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
