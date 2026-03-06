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

/** Create an initial HLC anchored to now for the given node. */
export function createHlc(nodeId: string): Hlc {
  return { wallMs: Date.now(), counter: 0, nodeId };
}

/**
 * Advance an HLC before *sending* a message.
 * Guarantees the returned timestamp is strictly greater than `prev`.
 */
export function sendHlc(prev: Hlc): Hlc {
  const now = Date.now();
  if (now > prev.wallMs) {
    return { wallMs: now, counter: 0, nodeId: prev.nodeId };
  }
  // Same millisecond — increment counter.
  return { wallMs: prev.wallMs, counter: prev.counter + 1, nodeId: prev.nodeId };
}

/**
 * Advance an HLC after *receiving* a remote message with timestamp `remote`.
 * The result is greater than both `local` and `remote`.
 */
export function recvHlc(local: Hlc, remote: Hlc): Hlc {
  const now = Date.now();
  const maxWall = Math.max(local.wallMs, remote.wallMs, now);

  if (maxWall === local.wallMs && maxWall === remote.wallMs) {
    // Both clocks are at the same ms — pick max counter + 1.
    return {
      wallMs: maxWall,
      counter: Math.max(local.counter, remote.counter) + 1,
      nodeId: local.nodeId,
    };
  }
  if (maxWall === local.wallMs) {
    return { wallMs: maxWall, counter: local.counter + 1, nodeId: local.nodeId };
  }
  if (maxWall === remote.wallMs) {
    return { wallMs: maxWall, counter: remote.counter + 1, nodeId: local.nodeId };
  }
  // Wall clock advanced past both — reset counter.
  return { wallMs: maxWall, counter: 0, nodeId: local.nodeId };
}

/** Compare two HLCs. Returns -1 if a < b, 1 if a > b, 0 if equal. */
export function compareHlc(a: Hlc, b: Hlc): -1 | 0 | 1 {
  if (a.wallMs !== b.wallMs) return a.wallMs < b.wallMs ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
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
  if (!Number.isFinite(wallMs) || wallMs < 0 || !Number.isFinite(counter) || counter < 0) {
    throw new Error(`Invalid HLC string: "${s}"`);
  }
  return { wallMs, counter, nodeId };
}
