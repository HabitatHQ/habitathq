/**
 * Hybrid Logical Clock (HLC) — provides causally consistent timestamps.
 *
 * An HLC tracks `wallMs` (wall-clock milliseconds), a `counter` for
 * same-millisecond disambiguation, and a `nodeId` for tie-breaking.
 *
 * References: Kulkarni et al. "Logical Physical Clocks and Consistent
 * Snapshots in Globally Distributed Databases", 2014.
 */

export interface Hlc {
  readonly wallMs: number;
  readonly counter: number;
  readonly nodeId: string;
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Returns whether `value` is a canonical, lowercase RFC 9562 UUIDv4 string. */
export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Returns whether `value` is a canonical, lowercase RFC 9562 UUIDv7 string. */
export function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}

/** Validate the structure of an untrusted HLC before ordering or persistence. */
export function isValidHlc(value: unknown): value is Hlc {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(candidate["wallMs"]) &&
    (candidate["wallMs"] as number) >= 0 &&
    Number.isSafeInteger(candidate["counter"]) &&
    (candidate["counter"] as number) >= 0 &&
    (candidate["counter"] as number) <= 0xffff_ffff &&
    isUuidV4(candidate["nodeId"])
  );
}

/**
 * Apply the fresh-upload future-clock admission bound after structural
 * validation. Authenticated history uses {@link isValidHlc} instead.
 */
export function isHlcWithinFutureBound(
  value: unknown,
  nowMs = Date.now(),
  maxFutureMs = 5 * 60_000,
): value is Hlc {
  return (
    isValidHlc(value) &&
    Number.isSafeInteger(nowMs) &&
    nowMs >= 0 &&
    Number.isSafeInteger(maxFutureMs) &&
    maxFutureMs >= 0 &&
    nowMs <= Number.MAX_SAFE_INTEGER - maxFutureMs &&
    value.wallMs <= nowMs + maxFutureMs
  );
}

/** Generate a canonical UUIDv7 for a replicated row. */
export function generateUuidV7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  let timestamp = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Create an initial HLC anchored to `nowMs` for the given node. */
export function createHlc(nodeId: string, nowMs = Date.now()): Hlc {
  return { wallMs: nowMs, counter: 0, nodeId };
}

/**
 * Maximum counter value — mirrors the Rust `u32::MAX` (4 294 967 295).
 * When the counter would exceed this, wallMs is advanced by 1 ms and
 * the counter is reset to 0, preserving the strictly-greater invariant.
 */
const COUNTER_MAX = 0xffff_ffff; // 2^32 − 1

/** Increment a counter, advancing wallMs on overflow (mirrors Rust u32). */
function nextCounter(wallMs: number, counter: number): { wallMs: number; counter: number } {
  if (counter >= COUNTER_MAX) {
    return { wallMs: wallMs + 1, counter: 0 };
  }
  return { wallMs, counter: counter + 1 };
}

/**
 * Advance an HLC before *sending* a message.
 * Guarantees the returned timestamp is strictly greater than `prev`.
 * If the counter would overflow `COUNTER_MAX`, wallMs is advanced by 1 ms.
 */
export function sendHlc(prev: Hlc, nowMs = Date.now()): Hlc {
  if (nowMs > prev.wallMs) {
    return { wallMs: nowMs, counter: 0, nodeId: prev.nodeId };
  }
  // Same millisecond — increment counter (with overflow guard).
  const next = nextCounter(prev.wallMs, prev.counter);
  return { ...next, nodeId: prev.nodeId };
}

/**
 * Advance an HLC after *receiving* a remote message with timestamp `remote`.
 * The result is greater than both `local` and `remote`.
 * If the counter would overflow `COUNTER_MAX`, wallMs is advanced by 1 ms.
 */
export function recvHlc(local: Hlc, remote: Hlc, nowMs = Date.now()): Hlc {
  const maxWall = Math.max(local.wallMs, remote.wallMs, nowMs);

  if (maxWall === local.wallMs && maxWall === remote.wallMs) {
    // Both clocks are at the same ms — pick max counter + 1 (with overflow guard).
    const next = nextCounter(maxWall, Math.max(local.counter, remote.counter));
    return { ...next, nodeId: local.nodeId };
  }
  if (maxWall === local.wallMs) {
    const next = nextCounter(maxWall, local.counter);
    return { ...next, nodeId: local.nodeId };
  }
  if (maxWall === remote.wallMs) {
    const next = nextCounter(maxWall, remote.counter);
    return { ...next, nodeId: local.nodeId };
  }
  // Wall clock advanced past both — reset counter.
  return { wallMs: maxWall, counter: 0, nodeId: local.nodeId };
}

/** Compare two HLCs. Returns -1 if a < b, 1 if a > b, 0 if equal. */
export function compareHlc(a: Hlc, b: Hlc): -1 | 0 | 1 {
  // Stryker disable next-line EqualityOperator -- `<` vs `<=` is equivalent when we've confirmed `!==`
  if (a.wallMs !== b.wallMs) return a.wallMs < b.wallMs ? -1 : 1;
  // Stryker disable next-line EqualityOperator -- same equivalence for counter
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  // Stryker disable next-line EqualityOperator -- same equivalence for nodeId
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
  return 0;
}

/** Serialise an HLC to a sortable string: `<wallMs>-<counter>-<nodeId>`. */
export function hlcToString(hlc: Hlc): string {
  // Zero-pad wallMs to 15 digits and counter to 10 digits for lexicographic sort.
  const wall = hlc.wallMs.toString().padStart(15, "0");
  const ctr = hlc.counter.toString().padStart(10, "0");
  return `${wall}-${ctr}-${hlc.nodeId}`;
}

/** Deserialise an HLC produced by {@link hlcToString}. Throws on malformed input. */
export function hlcFromString(s: string): Hlc {
  const firstDash = s.indexOf("-");
  const secondDash = s.indexOf("-", firstDash + 1);
  if (firstDash === -1 || secondDash === -1) {
    throw new Error(`Invalid HLC string: "${s}"`);
  }
  const wallMs = Number(s.slice(0, firstDash));
  const counter = Number(s.slice(firstDash + 1, secondDash));
  const nodeId = s.slice(secondDash + 1);
  // Stryker disable next-line ConditionalExpression,EqualityOperator -- wallMs<0 and counter<0 are unreachable via hlcToString format (leading `-` changes slice position, never yields negative numbers)
  if (!Number.isFinite(wallMs) || wallMs < 0 || !Number.isFinite(counter) || counter < 0) {
    throw new Error(`Invalid HLC string: "${s}"`);
  }
  return { wallMs, counter, nodeId };
}
