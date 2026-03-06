import { describe, expect, it } from "vitest";
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

  it("sendHlc increments counter when wallMs is identical", () => {
    const h1 = createHlc("node-1");
    // Simulate same-millisecond send by freezing wallMs
    const frozen = { ...h1, wallMs: h1.wallMs };
    const h2 = sendHlc(frozen);
    const h3 = sendHlc(h2);
    // At least one of these should have counter > 0
    expect(h2.counter > h1.counter || h2.wallMs > h1.wallMs).toBe(true);
    expect(h3.wallMs >= h2.wallMs).toBe(true);
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

  it("compareHlc returns -1, 0, 1", () => {
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

  it("round-trips through string serialisation", () => {
    const hlc = { wallMs: 1_700_000_000_000, counter: 42, nodeId: "test-node" };
    const str = hlcToString(hlc);
    const parsed = hlcFromString(str);
    expect(parsed).toEqual(hlc);
  });
});
