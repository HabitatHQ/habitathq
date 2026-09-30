import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { describe, expect, it } from "vitest";
import { PalladiumEngine, type RemoteChange } from "../engine.js";
import { compareHlc, type Hlc } from "../hlc.js";
import type { SchemaConfig } from "../migration.js";
import { sql } from "../sql.js";

type Schema = {
  notes: { id: string; title: string; body: string; updated_at: number };
};

const SCHEMA: SchemaConfig = {
  version: 1,
  schema:
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)",
};
const REPLICA_IDS = [
  "00000000-0000-4000-8000-0000000000a1",
  "00000000-0000-4000-8000-0000000000b2",
  "00000000-0000-4000-8000-0000000000c3",
] as const;
const ROW_A = "018f0f50-7b8d-7a1c-8e2f-1234567890ab";
const ROW_B = "018f0f50-7b8d-7a1c-8e2f-1234567890ac";

function configuredPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}

const FIRST_SEED = configuredPositiveInteger("PALLADIUM_SIM_SEED", 0x5eedc0de);
const SEED_COUNT = configuredPositiveInteger("PALLADIUM_SIM_SEEDS", 8);

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function changeId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function change(
  index: number,
  wallMs: number,
  nodeId: string,
  op: RemoteChange<Schema>["ops"][number],
): RemoteChange<Schema> {
  return { id: changeId(index), hlc: { wallMs, counter: 0, nodeId }, ops: [op] };
}

interface OracleRow {
  readonly values: Map<string, unknown>;
  readonly versions: Map<string, Hlc>;
  tombstone: Hlc | null;
}

function oracleRow(rows: Map<string, OracleRow>, id: string): OracleRow {
  const current = rows.get(id);
  if (current !== undefined) return current;
  const created = {
    values: new Map<string, unknown>(),
    versions: new Map<string, Hlc>(),
    tombstone: null,
  };
  rows.set(id, created);
  return created;
}

function applyOracle(rows: Map<string, OracleRow>, remote: RemoteChange<Schema>): void {
  const op = remote.ops[0];
  if (op === undefined) throw new Error("simulation change must have one operation");
  const row = oracleRow(rows, op.id);
  const wins = (stored: Hlc | undefined) =>
    stored === undefined || compareHlc(remote.hlc, stored) > 0;
  if (op.type === "delete") {
    const maxColumn = [...row.versions.values()].reduce<Hlc | null>(
      (maximum, version) =>
        maximum === null || compareHlc(version, maximum) > 0 ? version : maximum,
      null,
    );
    if (
      (row.tombstone !== null && compareHlc(remote.hlc, row.tombstone) <= 0) ||
      (maxColumn !== null && compareHlc(remote.hlc, maxColumn) <= 0)
    )
      return;
    row.tombstone = remote.hlc;
    return;
  }
  if (row.tombstone !== null && compareHlc(remote.hlc, row.tombstone) <= 0) return;
  if (op.type === "insert") {
    row.tombstone = null;
    for (const [column, value] of Object.entries(op.data)) {
      if (!wins(row.versions.get(column))) continue;
      row.values.set(column, value);
      row.versions.set(column, remote.hlc);
    }
    return;
  }
  for (const [column, value] of Object.entries(op.patch)) {
    if (!wins(row.versions.get(column))) continue;
    row.values.set(column, value);
    row.versions.set(column, remote.hlc);
  }
}

function oracleRows(changes: readonly RemoteChange<Schema>[]): Array<Schema["notes"]> {
  const rows = new Map<string, OracleRow>();
  for (const remote of [...changes].sort((left, right) => compareHlc(left.hlc, right.hlc)))
    applyOracle(rows, remote);
  return [...rows.entries()]
    .filter(([, row]) => row.tombstone === null)
    .map(([id, row]) => ({
      id,
      title: String(row.values.get("title")),
      body: String(row.values.get("body")),
      updated_at: Number(row.values.get("updated_at")),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function simulationChanges(seed: number): readonly RemoteChange<Schema>[] {
  const random = seededRandom(seed);
  const changes: RemoteChange<Schema>[] = [
    change(1, 1_000, REPLICA_IDS[0], {
      type: "insert",
      table: "notes",
      id: ROW_A,
      data: { id: ROW_A, title: "seed-a", body: "initial", updated_at: 1 },
    }),
    change(2, 1_001, REPLICA_IDS[1], {
      type: "insert",
      table: "notes",
      id: ROW_B,
      data: { id: ROW_B, title: "seed-b", body: "initial", updated_at: 1 },
    }),
  ];
  for (let index = 0; index < 12; index += 1) {
    const column = random() < 0.5 ? "title" : index % 3 === 0 ? "updated_at" : "body";
    const value =
      column === "updated_at" ? index + 2 : `${column}-${seed.toString(16)}-${index.toString()}`;
    changes.push(
      change(index + 3, 1_100 + index, REPLICA_IDS[index % REPLICA_IDS.length] ?? REPLICA_IDS[0], {
        type: "update",
        table: "notes",
        id: ROW_B,
        patch: { [column]: value },
      }),
    );
  }
  changes.push(
    change(100, 1_300, REPLICA_IDS[0], { type: "delete", table: "notes", id: ROW_A }),
    change(101, 1_400, REPLICA_IDS[1], {
      type: "insert",
      table: "notes",
      id: ROW_A,
      data: { id: ROW_A, title: "stale resurrection", body: "stale", updated_at: 2 },
    }),
    change(102, 1_500, REPLICA_IDS[2], { type: "delete", table: "notes", id: ROW_A }),
  );
  return changes;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const value = result[index];
    if (value === undefined || result[swap] === undefined) throw new Error("invalid shuffle index");
    result[index] = result[swap];
    result[swap] = value;
  }
  return result;
}

interface Replica {
  readonly nodeId: string;
  readonly filename: string;
  engine: PalladiumEngine<Schema>;
}

async function restart(replica: Replica): Promise<void> {
  await replica.engine.adapter.close();
  replica.engine = new PalladiumEngine(
    new NodeSqliteAdapter({ vfs: { type: "file", filename: replica.filename } }),
    {
      nodeId: replica.nodeId,
    },
  );
  await replica.engine.init(SCHEMA);
}

async function createReplicas(directory: string): Promise<Replica[]> {
  const replicas: Replica[] = [];
  for (const [index, nodeId] of REPLICA_IDS.entries()) {
    const filename = join(directory, `replica-${index.toString()}.sqlite`);
    const engine = new PalladiumEngine<Schema>(
      new NodeSqliteAdapter({ vfs: { type: "file", filename } }),
      { nodeId },
    );
    await engine.init(SCHEMA);
    replicas.push({ nodeId, filename, engine });
  }
  return replicas;
}

async function applyAndTrace(
  replica: Replica,
  replicaIndex: number,
  remote: RemoteChange<Schema>,
  phase: string,
  trace: string[],
): Promise<void> {
  await replica.engine.applyRemote(remote);
  trace.push(`r${replicaIndex}:${phase}:${remote.id}`);
}

async function runReplicaSchedule(
  replica: Replica,
  replicaIndex: number,
  seed: number,
  changes: readonly RemoteChange<Schema>[],
  trace: string[],
): Promise<void> {
  const initial = changes.slice(0, 2);
  const updates = changes.slice(2, -3);
  const delayedDeletes = changes.slice(-3);
  for (const remote of initial)
    await applyAndTrace(replica, replicaIndex, remote, "initial", trace);

  const random = seededRandom(seed + replicaIndex + 1);
  const reordered = shuffled(updates, random);
  const partitionAt = Math.floor(reordered.length / 2);
  for (const remote of reordered.slice(0, partitionAt)) {
    await applyAndTrace(replica, replicaIndex, remote, "deliver", trace);
    if (random() < 0.3) await applyAndTrace(replica, replicaIndex, remote, "duplicate", trace);
  }
  trace.push(`r${replicaIndex}:partition`);
  await restart(replica);
  trace.push(`r${replicaIndex}:restart`);
  for (const remote of delayedDeletes.toReversed())
    await applyAndTrace(replica, replicaIndex, remote, "interleave", trace);
  for (const remote of reordered.slice(partitionAt))
    await applyAndTrace(replica, replicaIndex, remote, "heal", trace);
}

async function assertReplicaState(
  replica: Replica,
  replicaIndex: number,
  expected: Array<Schema["notes"]>,
  seed: number,
  trace: string[],
): Promise<void> {
  const actual = await replica.engine.exec<Schema["notes"]>(
    sql`SELECT id, title, body, updated_at FROM notes ORDER BY id`,
  );
  expect(actual, `seed=${seed.toString()} trace=${trace.join(",")}`).toEqual(expected);
  expect(actual.some((row) => row.id === ROW_A)).toBe(false);
  trace.push(`r${replicaIndex}:assert`);
}

async function runSeed(seed: number): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "palladium-sync-simulation-"));
  const trace: string[] = [];
  const replicas: Replica[] = [];
  try {
    replicas.push(...(await createReplicas(directory)));
    const changes = simulationChanges(seed);
    for (const [replicaIndex, replica] of replicas.entries())
      await runReplicaSchedule(replica, replicaIndex, seed, changes, trace);
    const expected = oracleRows(changes);
    for (const [replicaIndex, replica] of replicas.entries())
      await assertReplicaState(replica, replicaIndex, expected, seed, trace);
  } finally {
    for (const replica of replicas) await replica.engine.adapter.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("seeded multi-replica SQLite convergence", () => {
  it("converges real engines to an independent LWW oracle", async () => {
    for (let offset = 0; offset < SEED_COUNT; offset += 1) await runSeed(FIRST_SEED + offset);
  });
});
