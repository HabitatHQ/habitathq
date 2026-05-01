import { describe, expect, it, vi } from "vitest";
import { compareHlc, createHlc, hlcFromString, hlcToString, recvHlc, sendHlc } from "../hlc.js";

describe("Hlc", () => {
  it("creates initial HLC with zero counter", () => {
    const hlc = createHlc("node-1");
    expect(hlc.counter).toBe(0);
    expect(hlc.nodeId).toBe("node-1");
    expect(hlc.wallMs).toBeGreaterThan(0);
  });

  it("sendHlc advances wallMs or counter", () => {
    const h1 = createHlc("node-1");
    const h2 = sendHlc(h1);
    expect(h2.wallMs).toBeGreaterThanOrEqual(h1.wallMs);
  });

  it("sendHlc increments counter when wall clock is frozen at the same ms", () => {
    const ts = 1_700_000_000_000;
    vi.setSystemTime(ts);
    const h1 = { wallMs: ts, counter: 3, nodeId: "n" };
    const h2 = sendHlc(h1);
    expect(h2.wallMs).toBe(ts);
    expect(h2.counter).toBe(4);
    vi.useRealTimers();
  });

  it("sendHlc resets counter when wall clock advances", () => {
    const h1 = { wallMs: 1_000, counter: 99, nodeId: "n" };
    vi.setSystemTime(2_000);
    const h2 = sendHlc(h1);
    expect(h2.wallMs).toBe(2_000);
    expect(h2.counter).toBe(0);
    vi.useRealTimers();
  });

  it("sequence of sends is strictly monotonically increasing", () => {
    const ts = Date.now();
    vi.setSystemTime(ts);
    let h = createHlc("n");
    for (let i = 0; i < 20; i++) {
      const next = sendHlc(h);
      expect(compareHlc(h, next)).toBe(-1);
      h = next;
    }
    vi.useRealTimers();
  });

  it("recvHlc merges remote HLC that is ahead", () => {
    const local = createHlc("a");
    const remote = { wallMs: local.wallMs + 1000, counter: 0, nodeId: "b" };
    const merged = recvHlc(local, remote);
    expect(merged.wallMs).toBeGreaterThanOrEqual(remote.wallMs);
  });

  it("recvHlc resolves same-ms tie by incrementing max counter", () => {
    const ts = Date.now();
    const local = { wallMs: ts, counter: 2, nodeId: "a" };
    const remote = { wallMs: ts, counter: 5, nodeId: "b" };
    const merged = recvHlc(local, remote);
    expect(merged.wallMs).toBe(ts);
    expect(merged.counter).toBe(6); // max(2,5)+1
  });

  it("recvHlc result is greater than both inputs", () => {
    const local = { wallMs: 500, counter: 0, nodeId: "a" };
    const remote = { wallMs: 400, counter: 10, nodeId: "b" };
    vi.setSystemTime(500);
    const merged = recvHlc(local, remote);
    expect(compareHlc(merged, local)).toBe(1);
    expect(compareHlc(merged, remote)).toBe(1);
    vi.useRealTimers();
  });

  it("recvHlc preserves local nodeId", () => {
    const local = { wallMs: 100, counter: 0, nodeId: "local-node" };
    const remote = { wallMs: 200, counter: 0, nodeId: "remote-node" };
    const merged = recvHlc(local, remote);
    expect(merged.nodeId).toBe("local-node");
  });

  it("compareHlc returns -1, 0, 1 for wallMs ordering", () => {
    const a = { wallMs: 100, counter: 0, nodeId: "x" };
    const b = { wallMs: 200, counter: 0, nodeId: "x" };
    const c = { wallMs: 100, counter: 1, nodeId: "x" };
    const d = { wallMs: 100, counter: 0, nodeId: "x" };

    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, a)).toBe(1);
    expect(compareHlc(a, c)).toBe(-1);
    expect(compareHlc(c, a)).toBe(1);
    expect(compareHlc(a, d)).toBe(0);
  });

  it("compareHlc breaks ties by counter then nodeId", () => {
    const sameWall = { wallMs: 100, counter: 0, nodeId: "a" };
    const higherCounter = { wallMs: 100, counter: 1, nodeId: "a" };
    const higherNodeId = { wallMs: 100, counter: 0, nodeId: "b" };

    expect(compareHlc(sameWall, higherCounter)).toBe(-1);
    expect(compareHlc(sameWall, higherNodeId)).toBe(-1);
    expect(compareHlc(higherNodeId, sameWall)).toBe(1);
  });

  it("hlcToString produces zero-padded lexicographically sortable format", () => {
    const earlier = { wallMs: 1_000_000_000_000, counter: 0, nodeId: "n" };
    const later = { wallMs: 1_700_000_000_000, counter: 0, nodeId: "n" };
    expect(hlcToString(earlier) < hlcToString(later)).toBe(true);
  });

  it("hlcToString zero-pads wallMs to 15 digits and counter to 10 digits", () => {
    const hlc = { wallMs: 1, counter: 1, nodeId: "n" };
    const str = hlcToString(hlc);
    const [wall, ctr] = str.split("-");
    expect(wall).toHaveLength(15);
    expect(ctr).toHaveLength(10);
  });

  it("hlcToString strings sort the same way compareHlc does", () => {
    const a = { wallMs: 100, counter: 5, nodeId: "a" };
    const b = { wallMs: 200, counter: 0, nodeId: "a" };
    const c = { wallMs: 100, counter: 6, nodeId: "a" };

    expect(hlcToString(a) < hlcToString(b)).toBe(compareHlc(a, b) === -1);
    expect(hlcToString(a) < hlcToString(c)).toBe(compareHlc(a, c) === -1);
  });

  it("round-trips through string serialisation", () => {
    const hlc = { wallMs: 1_700_000_000_000, counter: 42, nodeId: "test-node" };
    const str = hlcToString(hlc);
    const parsed = hlcFromString(str);
    expect(parsed).toEqual(hlc);
  });

  it("hlcFromString handles nodeId containing dashes", () => {
    const hlc = { wallMs: 1_700_000_000_000, counter: 0, nodeId: "node-a-b-c" };
    expect(hlcFromString(hlcToString(hlc))).toEqual(hlc);
  });

  it("hlcFromString accepts a short unpadded string with firstDash at position 1", () => {
    // Kills the UnaryOperator mutation that changes `firstDash === -1` to `firstDash === +1`:
    // a valid string like "1-0-n" has firstDash=1, so the mutant would wrongly throw.
    const parsed = hlcFromString("1-0-n");
    expect(parsed.wallMs).toBe(1);
    expect(parsed.counter).toBe(0);
    expect(parsed.nodeId).toBe("n");
  });

  // recvHlc branch coverage: verify exact counter values for each code path.

  it("recvHlc: local wallMs is the max — returns local.counter + 1", () => {
    // Freeze now below local.wallMs so local wins.
    vi.setSystemTime(500);
    const local = { wallMs: 600, counter: 5, nodeId: "a" };
    const remote = { wallMs: 400, counter: 10, nodeId: "b" };
    const merged = recvHlc(local, remote);
    expect(merged.wallMs).toBe(600);
    expect(merged.counter).toBe(6); // local.counter + 1, NOT max(5,10)+1=11
    expect(merged.nodeId).toBe("a");
    vi.useRealTimers();
  });

  it("recvHlc: remote wallMs is the max — returns remote.counter + 1", () => {
    vi.setSystemTime(500);
    const local = { wallMs: 400, counter: 5, nodeId: "a" };
    const remote = { wallMs: 600, counter: 10, nodeId: "b" };
    const merged = recvHlc(local, remote);
    expect(merged.wallMs).toBe(600);
    expect(merged.counter).toBe(11); // remote.counter + 1
    expect(merged.nodeId).toBe("a");
    vi.useRealTimers();
  });

  it("recvHlc: remote wallMs is the max with local counter higher — still returns remote.counter + 1 not max", () => {
    // Distinguishes the remote-wins branch from the all-equal branch:
    // When remote.wallMs = maxWall but local.counter > remote.counter,
    // result must be remote.counter+1 (not max(local,remote)+1).
    vi.setSystemTime(300);
    const local = { wallMs: 200, counter: 15, nodeId: "a" };
    const remote = { wallMs: 600, counter: 2, nodeId: "b" };
    const merged = recvHlc(local, remote);
    expect(merged.wallMs).toBe(600);
    expect(merged.counter).toBe(3); // remote.counter + 1, NOT max(15,2)+1=16
    vi.useRealTimers();
  });

  it("recvHlc: now > both — resets counter to 0", () => {
    vi.setSystemTime(700);
    const local = { wallMs: 400, counter: 5, nodeId: "a" };
    const remote = { wallMs: 500, counter: 10, nodeId: "b" };
    const merged = recvHlc(local, remote);
    expect(merged.wallMs).toBe(700);
    expect(merged.counter).toBe(0);
    vi.useRealTimers();
  });

  it("recvHlc: all three equal — picks max(local, remote) counter + 1", () => {
    vi.setSystemTime(500);
    const local = { wallMs: 500, counter: 3, nodeId: "a" };
    const remote = { wallMs: 500, counter: 7, nodeId: "b" };
    const merged = recvHlc(local, remote);
    expect(merged.wallMs).toBe(500);
    expect(merged.counter).toBe(8); // max(3,7) + 1
    vi.useRealTimers();
  });

  // compareHlc: verify all three comparison paths return the right sign.

  it("compareHlc: equal wallMs, equal counter, nodeId a > b returns 1", () => {
    const a = { wallMs: 100, counter: 0, nodeId: "b" };
    const b = { wallMs: 100, counter: 0, nodeId: "a" };
    expect(compareHlc(a, b)).toBe(1);
  });

  it("compareHlc: wallMs a > b returns 1 regardless of counter", () => {
    const a = { wallMs: 200, counter: 0, nodeId: "x" };
    const b = { wallMs: 100, counter: 99, nodeId: "x" };
    expect(compareHlc(a, b)).toBe(1);
    expect(compareHlc(b, a)).toBe(-1);
  });

  it("compareHlc: equal wallMs, counter a > b returns 1", () => {
    const a = { wallMs: 100, counter: 5, nodeId: "x" };
    const b = { wallMs: 100, counter: 3, nodeId: "x" };
    expect(compareHlc(a, b)).toBe(1);
    expect(compareHlc(b, a)).toBe(-1);
  });

  // hlcFromString validation.

  it("hlcFromString throws when there are no dashes", () => {
    expect(() => hlcFromString("1234567890123456")).toThrow("Invalid HLC");
  });

  it("hlcFromString throws when there is only one dash (numeric suffix)", () => {
    // Uses numeric parts so the L90 check won't catch this first — only L84 can.
    expect(() => hlcFromString("1700000000000-0000000042")).toThrow("Invalid HLC");
  });

  it("hlcFromString throws when wallMs is NaN", () => {
    expect(() => hlcFromString("abc-0-node")).toThrow("Invalid HLC");
  });

  it("hlcFromString throws when wallMs is Infinity", () => {
    expect(() => hlcFromString("Infinity-0-node")).toThrow("Invalid HLC");
  });

  it("hlcFromString throws when counter is NaN", () => {
    expect(() => hlcFromString("1700000000000-xyz-node")).toThrow("Invalid HLC");
  });

  it("hlcFromString throws when counter is Infinity", () => {
    expect(() => hlcFromString("1700000000000-Infinity-node")).toThrow("Invalid HLC");
  });

  // ── counter overflow (mirrors Rust u32::MAX semantics) ───────────────────
  // Freeze Date.now() so the wall-clock branch never fires unexpectedly.

  it("sendHlc advances wallMs when counter is at COUNTER_MAX", () => {
    const COUNTER_MAX = 0xffff_ffff;
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const h = { wallMs: 1_000, counter: COUNTER_MAX, nodeId: "n" };
      const h2 = sendHlc(h);
      expect(h2.wallMs).toBe(1_001);
      expect(h2.counter).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sendHlc result is strictly greater than prev at COUNTER_MAX", () => {
    const COUNTER_MAX = 0xffff_ffff;
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const h = { wallMs: 1_000, counter: COUNTER_MAX, nodeId: "n" };
      expect(compareHlc(sendHlc(h), h)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recvHlc advances wallMs when both counters are at COUNTER_MAX", () => {
    const COUNTER_MAX = 0xffff_ffff;
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const local = { wallMs: 1_000, counter: COUNTER_MAX, nodeId: "a" };
      const remote = { wallMs: 1_000, counter: COUNTER_MAX, nodeId: "b" };
      const merged = recvHlc(local, remote);
      expect(merged.wallMs).toBe(1_001);
      expect(merged.counter).toBe(0);
      expect(compareHlc(merged, local)).toBe(1);
      expect(compareHlc(merged, remote)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recvHlc advances wallMs when local counter is at COUNTER_MAX", () => {
    const COUNTER_MAX = 0xffff_ffff;
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    try {
      const local = { wallMs: 2_000, counter: COUNTER_MAX, nodeId: "a" };
      const remote = { wallMs: 1_000, counter: 5, nodeId: "b" };
      const merged = recvHlc(local, remote);
      expect(merged.wallMs).toBe(2_001);
      expect(merged.counter).toBe(0);
      expect(compareHlc(merged, local)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recvHlc advances wallMs when remote counter is at COUNTER_MAX", () => {
    const COUNTER_MAX = 0xffff_ffff;
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    try {
      const local = { wallMs: 1_000, counter: 5, nodeId: "a" };
      const remote = { wallMs: 2_000, counter: COUNTER_MAX, nodeId: "b" };
      const merged = recvHlc(local, remote);
      expect(merged.wallMs).toBe(2_001);
      expect(merged.counter).toBe(0);
      expect(compareHlc(merged, remote)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
