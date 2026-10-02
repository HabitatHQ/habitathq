import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PalladiumEngine, type RemoteChange } from "../engine.js";
import { compareHlc } from "../hlc.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";

type Schema = {
  notes: { id: string; title: string; body: string };
};

const NODE = "00000000-0000-4000-8000-000000000001";
const OTHER_NODE = "00000000-0000-4000-8000-000000000002";
const ROW = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
const OTHER_ROW = "018f0f50-7b8d-7a1c-8e2f-1234567890ac";
const SERVER_TIME = 1_700_000_000_000;
const TEN_YEARS = 10 * 365 * 24 * 60 * 60 * 1_000;
const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL)",
};

describe("authenticated engine clock", () => {
  let directory: string;
  const engines: PalladiumEngine<Schema>[] = [];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "palladium-clock-"));
    vi.spyOn(performance, "now").mockReturnValue(1_000);
  });

  afterEach(async () => {
    for (const engine of engines.splice(0)) await engine.adapter.close();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  async function open(
    filename = join(directory, "notes.sqlite"),
  ): Promise<PalladiumEngine<Schema>> {
    const engine = new PalladiumEngine<Schema>(
      new NodeSqliteAdapter({ vfs: { type: "file", filename } }),
      { nodeId: NODE },
    );
    await engine.init(SCHEMA);
    engines.push(engine);
    return engine;
  }

  it.each([-TEN_YEARS, TEN_YEARS])(
    "authors at trusted time despite wall skew %i and wall rollback",
    async (skew) => {
      const wall = vi.spyOn(Date, "now").mockReturnValue(SERVER_TIME + skew);
      const engine = await open();
      await engine.calibrateClock(SERVER_TIME);
      await engine.insert("notes", { id: ROW, title: "first", body: "retained" });
      const first = engine.currentHlc;
      expect(first?.wallMs).toBe(SERVER_TIME);
      wall.mockReturnValue(SERVER_TIME - TEN_YEARS);
      vi.mocked(performance.now).mockReturnValue(11_000);
      await engine.update("notes", ROW, { title: "later" });
      expect(engine.currentHlc?.wallMs).toBe(SERVER_TIME + 10_000);
      expect(await engine.exec(sql`SELECT title FROM notes WHERE id = ${ROW}`)).toEqual([
        { title: "later" },
      ]);
      if (first === null || engine.currentHlc === null) throw new Error("missing write HLC");
      expect(compareHlc(engine.currentHlc, first)).toBe(1);
    },
  );

  it("reopens with a conservative trusted clock and resumes the durable causal floor", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_TIME + TEN_YEARS);
    const first = await open();
    await first.calibrateClock(SERVER_TIME);
    await first.insert("notes", { id: ROW, title: "first", body: "retained" });
    const floor = first.currentHlc;
    await first.adapter.close();
    engines.splice(engines.indexOf(first), 1);
    const reopened = await open();
    await reopened.update("notes", ROW, { title: "after restart" });
    expect(reopened.currentHlc?.wallMs).toBe(SERVER_TIME);
    if (floor === null || reopened.currentHlc === null) throw new Error("missing write HLC");
    expect(compareHlc(reopened.currentHlc, floor)).toBe(1);
    expect(await reopened.exec(sql`SELECT title FROM notes WHERE id = ${ROW}`)).toEqual([
      { title: "after restart" },
    ]);
  });

  it("re-authors rejected versions so normal server edits can merge, retaining unrelated accepted work", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_TIME + TEN_YEARS);
    const engine = await open();
    const originals: RemoteChange<Schema>[] = [];
    engine.on("changes:local", (change) => {
      originals.push({ id: change.changeId, hlc: change.hlc, ops: change.ops });
    });
    await engine.insert("notes", { id: ROW, title: "draft", body: "retained" });
    await engine.update("notes", ROW, { title: "final intent" });
    await engine.applyRemote({
      id: "00000000-0000-4000-8000-000000000003",
      hlc: { wallMs: SERVER_TIME - 1_000, counter: 0, nodeId: OTHER_NODE },
      ops: [
        {
          type: "insert",
          table: "notes",
          id: OTHER_ROW,
          data: { id: OTHER_ROW, title: "accepted", body: "remote" },
        },
      ],
    });
    const serialized = JSON.stringify(originals);
    const replacements = await engine.reauthorClockRejectedChanges(
      originals,
      SERVER_TIME,
      async () => {},
    );
    expect(JSON.stringify(originals)).toBe(serialized);
    expect(
      replacements
        .map((change) => change.id)
        .some((id) => originals.some((change) => change.id === id)),
    ).toBe(false);
    expect(replacements.map((change) => change.ops)).toEqual(originals.map((change) => change.ops));
    expect(replacements.map((change) => change.hlc.wallMs)).toEqual([SERVER_TIME, SERVER_TIME]);
    expect(await engine.exec(sql`SELECT title, body FROM notes WHERE id = ${ROW}`)).toEqual([
      { title: "final intent", body: "retained" },
    ]);
    await engine.applyRemote({
      id: "00000000-0000-4000-8000-000000000004",
      hlc: { wallMs: SERVER_TIME + 500, counter: 0, nodeId: OTHER_NODE },
      ops: [{ type: "update", table: "notes", id: ROW, patch: { title: "normal later edit" } }],
    });
    expect(await engine.exec(sql`SELECT title FROM notes WHERE id = ${ROW}`)).toEqual([
      { title: "normal later edit" },
    ]);
    expect(await engine.exec(sql`SELECT title, body FROM notes WHERE id = ${OTHER_ROW}`)).toEqual([
      { title: "accepted", body: "remote" },
    ]);
    await engine.update("notes", ROW, { body: "new work" });
    expect(engine.currentHlc?.wallMs).toBe(SERVER_TIME + 500);
  });

  it("overlapping old and replacement versions merge identically to a fresh replica", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_TIME);
    const recovered = await open();
    const originals: RemoteChange<Schema>[] = [];
    recovered.on("changes:local", (change) =>
      originals.push({
        id: change.changeId,
        hlc: change.hlc,
        ops: change.ops,
      }),
    );
    await recovered.insert("notes", { id: ROW, title: "first", body: "retained" });
    await recovered.insert("notes", { id: OTHER_ROW, title: "second", body: "retained" });
    const replacements = await recovered.reauthorClockRejectedChanges(
      originals,
      SERVER_TIME,
      async () => {},
    );
    expect(replacements[0]?.hlc).toEqual(originals[1]?.hlc);
    const peer = await open(join(directory, "peer.sqlite"));
    await peer.calibrateClock(SERVER_TIME);
    for (const change of replacements) await peer.applyRemote(change);
    const competing: RemoteChange<Schema> = {
      id: "00000000-0000-4000-8000-000000000005",
      hlc: { wallMs: SERVER_TIME, counter: 1, nodeId: OTHER_NODE },
      ops: [{ type: "update", table: "notes", id: ROW, patch: { title: "tie-break winner" } }],
    };
    await recovered.applyRemote(competing);
    await peer.applyRemote(competing);
    const expected = [
      { id: ROW, title: "tie-break winner", body: "retained" },
      { id: OTHER_ROW, title: "second", body: "retained" },
    ];
    expect(await recovered.exec(sql`SELECT * FROM notes ORDER BY id`)).toEqual(expected);
    expect(await peer.exec(sql`SELECT * FROM notes ORDER BY id`)).toEqual(expected);
  });

  it("rolls back both conflict versions and clock when recovery archival fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_TIME + TEN_YEARS);
    const engine = await open();
    const originals: RemoteChange<Schema>[] = [];
    engine.on("changes:local", (change) =>
      originals.push({ id: change.changeId, hlc: change.hlc, ops: change.ops }),
    );
    await engine.insert("notes", { id: ROW, title: "pending", body: "retained" });
    const floor = engine.currentHlc;
    await expect(
      engine.reauthorClockRejectedChanges(
        originals,
        SERVER_TIME,
        async (_replacements, adapter) => {
          await adapter.exec("CREATE TABLE recovery_marker (id TEXT)");
          throw new Error("archive failed");
        },
      ),
    ).rejects.toThrow("archive failed");
    expect(engine.currentHlc).toEqual(floor);
    expect(await engine.getSyncState("trusted_server_time")).toBeNull();
    await engine.applyRemote({
      hlc: { wallMs: SERVER_TIME + 500, counter: 0, nodeId: OTHER_NODE },
      ops: [{ type: "update", table: "notes", id: ROW, patch: { title: "older remote" } }],
    });
    expect(await engine.exec(sql`SELECT title FROM notes WHERE id = ${ROW}`)).toEqual([
      { title: "pending" },
    ]);
    expect(
      await engine.exec(sql`SELECT name FROM sqlite_master WHERE name = 'recovery_marker'`),
    ).toEqual([]);
  });

  it("a rejected future remote transaction cannot poison later authoring time", async () => {
    const engine = await open();
    await engine.calibrateClock(SERVER_TIME);
    await engine.insert("notes", { id: ROW, title: "valid", body: "retained" });
    const before = engine.currentHlc;
    await engine.exec(sql`CREATE TRIGGER reject_invalid_title BEFORE INSERT ON notes
      WHEN NEW.title = 'invalid' BEGIN SELECT RAISE(ABORT, 'invalid title'); END`);
    await expect(
      engine.applyRemote({
        id: "00000000-0000-4000-8000-000000000009",
        hlc: { wallMs: SERVER_TIME + TEN_YEARS, counter: 0, nodeId: OTHER_NODE },
        ops: [
          {
            type: "insert",
            table: "notes",
            id: OTHER_ROW,
            data: { id: OTHER_ROW, title: "invalid", body: "invalid" },
          },
        ],
      }),
    ).rejects.toThrow("invalid title");
    expect(engine.currentHlc).toEqual(before);
    await engine.update("notes", ROW, { title: "still bounded" });
    expect(engine.currentHlc?.wallMs).toBe(SERVER_TIME);
    expect(await engine.exec(sql`SELECT id, title FROM notes ORDER BY id`)).toEqual([
      { id: ROW, title: "still bounded" },
    ]);
    expect(await engine.getSyncState("accepted_hlc")).toBeNull();
  });

  it("refuses to lower an acknowledged future floor or re-author a remotely accepted identity", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_TIME + TEN_YEARS);
    const engine = await open();
    const originals: RemoteChange<Schema>[] = [];
    engine.on("changes:local", (change) =>
      originals.push({ id: change.changeId, hlc: change.hlc, ops: change.ops }),
    );
    await engine.insert("notes", { id: ROW, title: "accepted", body: "retained" });
    const original = originals[0];
    if (original === undefined) throw new Error("missing local Change");
    await engine.recordAcceptedClock(original.hlc);
    await expect(
      engine.reauthorClockRejectedChanges(originals, SERVER_TIME, async () => {}),
    ).rejects.toThrow("cannot lower accepted");
    await engine.applyRemote(original);
    await expect(
      engine.reauthorClockRejectedChanges(originals, SERVER_TIME + TEN_YEARS, async () => {}),
    ).rejects.toThrow("accepted Change");
    expect(await engine.exec(sql`SELECT title FROM notes WHERE id = ${ROW}`)).toEqual([
      { title: "accepted" },
    ]);
  });
});
