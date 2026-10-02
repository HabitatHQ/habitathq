import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PalladiumEngine } from "../engine.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";
import { SyncTransport, type WireChange } from "../sync.js";

type Schema = { notes: { id: string; title: string } };
const SCHEMA: SchemaConfig = {
  version: 1,
  schema: "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
};
const NODE = "00000000-0000-4000-8000-00000000b0b0";
const SERVER = "http://clock.test";
const SERVER_NOW = 1_800_000_000_000;
const ROW = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function clockResponse(nowMs = SERVER_NOW): Response {
  return json({ version: 1, nowMs, maxFutureMs: 300_000 });
}
function page(changes: readonly WireChange[] = []): Response {
  return json({
    version: 1,
    changes,
    purges: [],
    events: [],
    cursor: "0",
    upperBound: "0",
    caughtUp: true,
    control: { mustRefetch: false },
  });
}
async function engine(): Promise<PalladiumEngine<Schema>> {
  const result = new PalladiumEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), {
    nodeId: NODE,
  });
  await result.init(SCHEMA);
  return result;
}
function outbox(db: PalladiumEngine<Schema>) {
  return db.adapter.exec<{
    change_id: string;
    hlc_wall_ms: number;
    hlc_counter: number;
    hlc_node_id: string;
    ops: string;
  }>(
    "SELECT change_id, hlc_wall_ms, hlc_counter, hlc_node_id, ops FROM _sync_outbox ORDER BY change_id",
    [],
  );
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof Request) return input.url;
  return input.href;
}

function recoveryPost(init: RequestInit | undefined, rejectOriginal: boolean): Response {
  const change = JSON.parse(String(init?.body)) as WireChange;
  if (rejectOriginal && change.hlc.wallMs < SERVER_NOW) {
    return json({ code: "clock_skew", message: "HLC exceeds server future bound" }, 400);
  }
  return json({ version: 1, outcome: "inserted", cursor: "1" }, 201);
}

afterEach(() => vi.useRealTimers());

describe("clock-aware sync transport", () => {
  it("keeps disposed recovery from using a replacement transport's engine lease", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_NOW);
    const db = await engine();
    const retired = new SyncTransport(db, {
      serverUrl: SERVER,
      fetch: async () => {
        throw new Error("Disposed transport attempted a request");
      },
    });
    await db.insert("notes", { id: ROW, title: "retained intent" });
    const original = await outbox(db);
    await retired.dispose();
    const active = new SyncTransport(db, {
      serverUrl: SERVER,
      fetch: async (input, init) => {
        if (requestUrl(input).endsWith("/v1/clock")) return clockResponse();
        if (init?.method === "POST")
          return json({ version: 1, outcome: "inserted", cursor: "1" }, 201);
        return page();
      },
    });
    await expect(retired.recoverClock()).rejects.toThrow("disposed transport");
    expect(await outbox(db)).toEqual(original);
    await active.syncOnce();
    expect(await outbox(db)).toEqual([]);
    expect(await db.exec(sql`SELECT title FROM notes WHERE id = ${ROW}`)).toEqual([
      { title: "retained intent" },
    ]);
    await active.dispose();
    await db.adapter.close();
  });

  it("authors bounded writes after startup calibration with a client clock ten years fast", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_NOW + 10 * 365 * 24 * 60 * 60 * 1_000);
    const db = await engine();
    const posted: WireChange[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
      if (new URL(url).pathname === "/v1/clock") return clockResponse();
      if (init?.method === "POST") {
        const change = JSON.parse(String(init.body)) as WireChange;
        posted.push(change);
        return change.hlc.wallMs <= SERVER_NOW + 300_000
          ? json({ version: 1, outcome: "inserted", cursor: "1" }, 201)
          : json({ code: "clock_skew", message: "too far in future" }, 400);
      }
      return page();
    };
    const transport = new SyncTransport(db, {
      serverUrl: SERVER,
      fetch,
      pollIntervalMs: 60_000,
    });
    await transport.start();
    await db.insert("notes", { id: ROW, title: "calibrated before first write" });
    await transport.syncOnce();
    expect(posted).toHaveLength(1);
    expect(posted[0]?.hlc.wallMs).toBeGreaterThanOrEqual(SERVER_NOW);
    expect(posted[0]?.hlc.wallMs).toBeLessThanOrEqual(SERVER_NOW + 300_000);
    expect(await outbox(db)).toEqual([]);
    await transport.dispose();
    await db.adapter.close();
  });

  it("rejects malformed authenticated clock samples and does not upload", async () => {
    const db = await engine();
    let posts = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
      if (new URL(url).pathname === "/v1/clock") {
        return json({
          version: 1,
          nowMs: SERVER_NOW,
          maxFutureMs: 300_000,
          unrecognized: true,
        });
      }
      if (init?.method === "POST") posts += 1;
      return page();
    };
    const transport = new SyncTransport(db, { serverUrl: SERVER, fetch });
    await transport.start();
    await db.insert("notes", { id: ROW, title: "must not upload" });
    await transport.syncOnce();
    expect(posts).toBe(0);
    expect(await outbox(db)).toHaveLength(1);
    expect(transport.lastError?.code).toBe("invalid_clock");
    await transport.dispose();
    await db.adapter.close();
  });
  it("applies authenticated server history while the client wall clock is ten years slow", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_NOW - 10 * 365 * 24 * 60 * 60 * 1_000);
    const db = await engine();
    const change: WireChange = {
      id: "00000000-0000-4000-8000-000000000001",
      hlc: { wallMs: SERVER_NOW, counter: 0, nodeId: NODE },
      ops: [
        {
          op: "insert",
          table: "notes",
          row_id: ROW,
          data: { id: ROW, title: "accepted history" },
        },
      ],
    };
    const transport = new SyncTransport(db, {
      serverUrl: SERVER,
      fetch: async (input) =>
        new URL(
          typeof input === "string" ? input : input instanceof Request ? input.url : input.href,
        ).pathname === "/v1/clock"
          ? clockResponse()
          : page([change]),
    });
    await transport.poll();
    expect(await db.exec<Schema["notes"]>(sql`SELECT id, title FROM notes`)).toEqual([
      { id: ROW, title: "accepted history" },
    ]);
    await transport.dispose();
    await db.adapter.close();
  });

  it("reconfirms, archives immutable originals, and enqueues fresh bounded identities", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_NOW - 10 * 365 * 24 * 60 * 60 * 1_000);
    const db = await engine();
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    let rejectOld = true;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : undefined;
      requests.push({ method, url, ...(body === undefined ? {} : { body }) });
      if (new URL(url).pathname === "/v1/clock") return clockResponse();
      if (method !== "POST") return page();
      const response = recoveryPost(init, rejectOld);
      if (response.status === 201) rejectOld = false;
      return response;
    };
    const transport = new SyncTransport(db, { serverUrl: SERVER, fetch });
    await transport.poll();
    await db.insert("notes", { id: ROW, title: "recover me" });
    const [original] = await outbox(db);
    expect(original).toBeDefined();
    if (original === undefined) throw new Error("outbox row missing");
    const originalBytes = JSON.stringify({
      id: original.change_id,
      hlc: {
        wallMs: original.hlc_wall_ms,
        counter: original.hlc_counter,
        nodeId: original.hlc_node_id,
      },
      ops: JSON.parse(original.ops) as unknown,
    });

    await transport.syncOnce();
    expect((await outbox(db)).map((row) => row.change_id)).toEqual([original.change_id]);
    const recovered = await transport.recoverClock();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.originalChangeId).toBe(original.change_id);
    expect(recovered[0]?.replacementChangeId).not.toBe(original.change_id);
    const evidence = (await transport.inspectQuarantine()).filter(
      (entry) => entry.disposition === "superseded",
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.payload).toBe(originalBytes);
    expect(evidence[0]?.hlcWallMs).toBe(original.hlc_wall_ms);
    expect(evidence[0]?.code).toBe("clock_skew");
    expect(evidence[0]?.replacementChangeId).toBe(recovered[0]?.replacementChangeId);
    await expect(transport.retryQuarantined(original.change_id)).rejects.toThrow("superseded");
    await transport.discardQuarantined(original.change_id);
    expect(
      (await transport.inspectQuarantine()).find((entry) => entry.changeId === original.change_id),
    ).toMatchObject({ disposition: "superseded", payload: originalBytes });
    const [replacement] = await outbox(db);
    expect(replacement?.change_id).toBe(recovered[0]?.replacementChangeId);
    expect(replacement?.hlc_wall_ms).toBeGreaterThanOrEqual(SERVER_NOW);

    await transport.syncOnce();
    expect(await outbox(db)).toEqual([]);
    expect(requests.filter((request) => request.url.endsWith("/v1/clock")).length).toBeGreaterThan(
      0,
    );
    await transport.dispose();
    await db.adapter.close();
  });

  it("does not replace a lost-ack original once retry confirms its accepted receipt", async () => {
    const db = await engine();
    let changeId: string | undefined;
    let firstPost = true;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
      if (new URL(url).pathname === "/v1/clock") return clockResponse();
      if (init?.method === "POST") {
        const change = JSON.parse(String(init.body)) as WireChange;
        changeId = change.id;
        if (firstPost) {
          firstPost = false;
          throw new TypeError("lost acknowledgement");
        }
        return json({ version: 1, outcome: "duplicate", cursor: "1" }, 201);
      }
      return page();
    };
    const transport = new SyncTransport(db, { serverUrl: SERVER, fetch });
    await transport.poll();
    await db.insert("notes", { id: ROW, title: "accepted" });
    await transport.syncOnce();
    expect(await outbox(db)).toHaveLength(1);
    expect(await transport.recoverClock()).toEqual([]);
    expect(await outbox(db)).toEqual([]);
    expect(
      (await transport.inspectQuarantine()).filter((entry) => entry.disposition === "superseded"),
    ).toEqual([]);
    expect(changeId).toBeDefined();
    await transport.dispose();
    await db.adapter.close();
  });

  it("aborts recovery when the confirmed outbox snapshot changes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_NOW - 10 * 365 * 24 * 60 * 60 * 1_000);
    const db = await engine();
    let addConcurrent = false;
    let inserted = false;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
      if (new URL(url).pathname === "/v1/clock") return clockResponse();
      if (init?.method === "POST") {
        if (addConcurrent && !inserted) {
          inserted = true;
          await db.insert("notes", {
            id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
            title: "concurrent write",
          });
        }
        return json({ code: "clock_skew", message: "too far in future" }, 400);
      }
      return page();
    };
    const transport = new SyncTransport(db, { serverUrl: SERVER, fetch });
    await transport.poll();
    await db.insert("notes", { id: ROW, title: "rejected" });
    addConcurrent = true;
    await expect(transport.recoverClock()).rejects.toThrow("outbox changed");
    expect(
      (await transport.inspectQuarantine()).filter((entry) => entry.disposition === "superseded"),
    ).toEqual([]);
    expect((await outbox(db)).length).toBe(2);
    await transport.dispose();
    await db.adapter.close();
  });

  it.each([
    ["non-clock rejection", () => json({ code: "bad_request", message: "invalid" }, 400)],
    ["invalid receipt", () => json({ version: 1, outcome: "inserted" }, 201)],
    ["mislabeled server error", () => json({ code: "clock_skew", message: "unexpected" }, 500)],
    ["authentication rejection", () => json({ code: "unauthorized", message: "no token" }, 401)],
  ])("does not re-author originals after %s", async (_name, postResponse) => {
    const db = await engine();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
      if (new URL(url).pathname === "/v1/clock") return clockResponse();
      if (init?.method === "POST") return postResponse();
      return page();
    };
    const transport = new SyncTransport(db, { serverUrl: SERVER, fetch });
    await transport.poll();
    await db.insert("notes", { id: ROW, title: "preserve on failure" });
    const originals = await outbox(db);
    await expect(transport.recoverClock()).rejects.toThrow();
    expect(await outbox(db)).toEqual(originals);
    expect(
      (await transport.inspectQuarantine()).filter((entry) => entry.disposition === "superseded"),
    ).toEqual([]);
    await transport.dispose();
    await db.adapter.close();
  });

  it("retains recovery evidence and replacement identity across a client restart", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_NOW - 10 * 365 * 24 * 60 * 60 * 1_000);
    const directory = mkdtempSync(join(tmpdir(), "palladium-clock-recovery-"));
    const filename = join(directory, "client.sqlite");
    const postedIds: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
      if (new URL(url).pathname === "/v1/clock") return clockResponse();
      if (init?.method === "POST") {
        const change = JSON.parse(String(init.body)) as WireChange;
        postedIds.push(change.id);
        if (change.hlc.wallMs < SERVER_NOW) {
          return json({ code: "clock_skew", message: "too far in future" }, 400);
        }
        return json({ version: 1, outcome: "inserted", cursor: "1" }, 201);
      }
      return page();
    };
    try {
      const first = new PalladiumEngine<Schema>(
        new NodeSqliteAdapter({ vfs: { type: "file", filename } }),
        { nodeId: NODE },
      );
      await first.init(SCHEMA);
      const firstTransport = new SyncTransport(first, { serverUrl: SERVER, fetch });
      await firstTransport.poll();
      await first.insert("notes", { id: ROW, title: "persisted" });
      const [original] = await outbox(first);
      if (original === undefined) throw new Error("original outbox entry missing");
      await expect(firstTransport.recoverClock()).resolves.toHaveLength(1);
      const [replacement] = await outbox(first);
      if (replacement === undefined) throw new Error("replacement outbox entry missing");
      const replacementId = replacement.change_id;
      await firstTransport.dispose();
      await first.adapter.close();

      const reopened = new PalladiumEngine<Schema>(
        new NodeSqliteAdapter({ vfs: { type: "file", filename } }),
        { nodeId: NODE },
      );
      await reopened.init(SCHEMA);
      const resumedTransport = new SyncTransport(reopened, { serverUrl: SERVER, fetch });
      const archived = (await resumedTransport.inspectQuarantine()).filter(
        (entry) => entry.disposition === "superseded",
      );
      expect(archived).toHaveLength(1);
      expect(archived[0]?.changeId).toBe(original.change_id);
      expect(archived[0]?.replacementChangeId).toBe(replacementId);
      await resumedTransport.syncOnce();
      expect(await outbox(reopened)).toEqual([]);
      expect(postedIds.filter((id) => id === original.change_id)).toHaveLength(1);
      expect(postedIds.at(-1)).toBe(replacementId);
      await resumedTransport.dispose();
      await reopened.adapter.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
