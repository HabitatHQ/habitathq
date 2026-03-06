import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "../event-emitter.js";

interface TestEvents {
  data: string;
  count: number;
  done: undefined;
}

describe("EventEmitter", () => {
  it("calls listener on emit", () => {
    const ee = new EventEmitter<TestEvents>();
    const cb = vi.fn();
    ee.on("data", cb);
    ee.emit("data", "hello");
    expect(cb).toHaveBeenCalledWith("hello");
  });

  it("supports multiple listeners for the same event", () => {
    const ee = new EventEmitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    ee.on("data", a);
    ee.on("data", b);
    ee.emit("data", "x");
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("off() removes a specific listener", () => {
    const ee = new EventEmitter<TestEvents>();
    const cb = vi.fn();
    ee.on("data", cb);
    ee.off("data", cb);
    ee.emit("data", "y");
    expect(cb).not.toHaveBeenCalled();
  });

  it("on() returns an unsubscribe function", () => {
    const ee = new EventEmitter<TestEvents>();
    const cb = vi.fn();
    const unsub = ee.on("data", cb);
    unsub();
    ee.emit("data", "z");
    expect(cb).not.toHaveBeenCalled();
  });

  it("once() fires exactly once", () => {
    const ee = new EventEmitter<TestEvents>();
    const cb = vi.fn();
    ee.once("count", cb);
    ee.emit("count", 1);
    ee.emit("count", 2);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(1);
  });
});
