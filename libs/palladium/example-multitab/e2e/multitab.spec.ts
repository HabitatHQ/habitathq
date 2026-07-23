/**
 * Two pages in one browser context = two tabs on one origin, sharing OPFS,
 * Web Locks, and BroadcastChannel. Exercises the three properties the spike
 * exists to prove.
 */

import { expect, type Page, test } from "@playwright/test";

const roleOf = (p: Page) => p.locator("#role");
const notes = (p: Page) => p.locator("#list li");

async function addNote(p: Page, body: string): Promise<void> {
  await p.locator("#body").fill(body);
  await p.locator("#add").click();
}

// Each page settles into leader/follower once its worker resolves the lock.
async function waitRole(p: Page, role: "leader" | "follower"): Promise<void> {
  await expect(roleOf(p)).toHaveAttribute("data-role", role, { timeout: 15_000 });
}

test("single owner, live cross-tab propagation, seamless failover", async ({ browser }) => {
  const ctx = await browser.newContext();

  // ── Tab A opens first → wins the lock → leader → owns OPFS ───────────────
  const a = await ctx.newPage();
  await a.goto("/");
  await waitRole(a, "leader");

  // Start from a clean slate (OPFS may persist across runs in a real profile).
  await a.locator("#clear").click();
  await expect(notes(a)).toHaveCount(0);

  // ── Tab B opens second → loses the lock → follower ───────────────────────
  const b = await ctx.newPage();
  await b.goto("/");
  await waitRole(b, "follower");

  // Exactly one leader.
  expect(await roleOf(a).getAttribute("data-role")).toBe("leader");

  // ── A writes; B sees it live (BroadcastChannel invalidation) ─────────────
  await addNote(a, "from A");
  await expect(notes(b)).toHaveText(["from A"]);

  // ── B writes (proxied to leader A over Comlink/BroadcastChannel); A sees it
  await addNote(b, "from B");
  await expect(notes(a)).toHaveText(["from B", "from A"]);

  // ── Failover: close the leader; B must take over and keep working ────────
  await a.close();
  await waitRole(b, "leader");

  // Data persisted in OPFS across the handoff.
  await expect(notes(b)).toHaveText(["from B", "from A"]);

  // The new leader still accepts writes.
  await addNote(b, "after failover");
  await expect(notes(b)).toHaveText(["after failover", "from B", "from A"]);

  await ctx.close();
});
