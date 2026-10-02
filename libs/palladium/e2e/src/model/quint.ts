import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

export interface DeliveryState {
  readonly committed: readonly number[];
  readonly outbox: readonly number[];
  readonly history: readonly number[];
  readonly applied: readonly number[];
  readonly checkpoint: number;
  readonly lastAction: string;
  readonly lastId: number;
}

export interface DeliveryTrace {
  readonly source: string;
  readonly states: readonly DeliveryState[];
}

const execFileAsync = promisify(execFile);
const e2eRoot = resolve(import.meta.dirname, "../..");
const modelPath = join(e2eRoot, "models", "delivery.qnt");
const quintPath = join(e2eRoot, "node_modules", ".bin", "quint");
const defaultSeed = "0x5eedc0de";

function itfInteger(value: unknown, context: string): number {
  if (
    typeof value !== "object" ||
    value === null ||
    !("#bigint" in value) ||
    typeof value["#bigint"] !== "string" ||
    !/^-?\d+$/.test(value["#bigint"])
  ) {
    throw new Error(`${context} must be an ITF integer`);
  }
  const number = Number(value["#bigint"]);
  if (!Number.isSafeInteger(number)) throw new Error(`${context} must be a safe integer`);
  return number;
}

function itfCollection(value: unknown, context: string, isSet: boolean): readonly number[] {
  let entries: unknown;
  if (isSet) {
    if (typeof value !== "object" || value === null || !("#set" in value)) {
      throw new Error(`${context} must be an ITF set`);
    }
    entries = value["#set"];
  } else {
    entries = value;
  }
  if (!Array.isArray(entries))
    throw new Error(`${context} has an invalid ITF ${isSet ? "set" : "list"} encoding`);
  const values = entries.map((entry, index) => itfInteger(entry, `${context}[${index}]`));
  if (isSet && new Set(values).size !== values.length)
    throw new Error(`${context} contains duplicate set elements`);
  return values;
}

function decodeState(raw: unknown, context: string): DeliveryState {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("committed" in raw) ||
    !("outbox" in raw) ||
    !("history" in raw) ||
    !("applied" in raw) ||
    !("checkpoint" in raw) ||
    !("lastAction" in raw) ||
    !("lastId" in raw)
  ) {
    throw new Error(`${context} must contain the delivery model state`);
  }
  const lastAction = raw.lastAction;
  if (typeof lastAction !== "string") throw new Error(`${context}.lastAction must be a string`);
  const checkpoint = itfInteger(raw.checkpoint, `${context}.checkpoint`);
  const lastId = itfInteger(raw.lastId, `${context}.lastId`);
  return {
    committed: itfCollection(raw.committed, `${context}.committed`, true),
    outbox: itfCollection(raw.outbox, `${context}.outbox`, false),
    history: itfCollection(raw.history, `${context}.history`, false),
    applied: itfCollection(raw.applied, `${context}.applied`, true),
    checkpoint,
    lastAction,
    lastId,
  };
}

function decodeItf(value: unknown, source: string, context: string): DeliveryTrace {
  if (
    typeof value !== "object" ||
    value === null ||
    !("#meta" in value) ||
    !("vars" in value) ||
    !("states" in value) ||
    !Array.isArray(value.vars)
  ) {
    throw new Error(`${context} is missing ITF metadata or variable declarations`);
  }
  const vars = value.vars;
  const required = [
    "committed",
    "outbox",
    "history",
    "applied",
    "checkpoint",
    "lastAction",
    "lastId",
  ];
  if (vars.length !== required.length || required.some((name) => !vars.includes(name))) {
    throw new Error(`${context}.vars does not match the delivery model state contract`);
  }
  const rawStates = value.states;
  if (!Array.isArray(rawStates) || rawStates.length === 0)
    throw new Error(`${context}.states must be a non-empty array`);
  return {
    source,
    states: rawStates.map((state, index) => decodeState(state, `${context}.states[${index}]`)),
  };
}

async function readTraces(directory: string, source: string): Promise<readonly DeliveryTrace[]> {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".itf.json")).sort();
  if (files.length === 0) throw new Error(`Quint produced no ${source} ITF traces`);
  const traces: DeliveryTrace[] = [];
  for (const file of files) {
    const text = await readFile(join(directory, file), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`Could not parse Quint ITF ${file}: ${String(error)}`);
    }
    traces.push(decodeItf(parsed, `${source} (${file})`, file));
  }
  return traces;
}

export async function generateDeliveryTraces(): Promise<readonly DeliveryTrace[]> {
  const tempDir = await mkdtemp(join(tmpdir(), "palladium-quint-traces-"));
  try {
    const recoveryDir = join(tempDir, "recovery");
    const seededDir = join(tempDir, "seeded");
    await mkdir(recoveryDir);
    await mkdir(seededDir);
    const seed = process.env["PALLADIUM_QUINT_SEED"] ?? defaultSeed;
    await execFileAsync(
      quintPath,
      [
        "run",
        modelPath,
        "--backend=typescript",
        "--step",
        "recoveryStep",
        "--max-samples",
        "1",
        "--n-traces",
        "1",
        "--max-steps",
        "13",
        "--seed",
        seed,
        "--invariants",
        "safety",
        "--out-itf",
        join(recoveryDir, "recovery_{seq}.itf.json"),
      ],
      { cwd: e2eRoot, maxBuffer: 8 * 1024 * 1024 },
    );
    await execFileAsync(
      quintPath,
      [
        "run",
        modelPath,
        "--backend=typescript",
        "--step",
        "step",
        "--max-samples",
        "8",
        "--n-traces",
        "8",
        "--max-steps",
        "18",
        "--seed",
        seed,
        "--invariants",
        "safety",
        "--out-itf",
        join(seededDir, "seeded_{seq}.itf.json"),
      ],
      { cwd: e2eRoot, maxBuffer: 8 * 1024 * 1024 },
    );
    const recovery = await readTraces(recoveryDir, `recovery schedule seed ${seed}`);
    if (recovery.length !== 1 || recovery[0]?.states.length !== 14) {
      throw new Error("Quint recovery schedule did not produce one 14-state trace");
    }
    const seeded = await readTraces(seededDir, `seeded simulation seed ${seed}`);
    if (seeded.length !== 8)
      throw new Error("Quint did not produce the complete eight-trace campaign");
    return [...recovery, ...seeded];
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
