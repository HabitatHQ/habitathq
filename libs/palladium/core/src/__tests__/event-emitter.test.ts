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

  it("off() only removes the target listener, not others on the same event", () => {
    const ee = new EventEmitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    ee.on("data", a);
    ee.on("data", b);
    ee.off("data", a);
    ee.emit("data", "z");
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
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

  it("emit with no listeners does not throw", () => {
    const ee = new EventEmitter<TestEvents>();
    expect(() => ee.emit("data", "no-listeners")).not.toThrow();
  });

  it("removeAllListeners() removes all listeners for all events", () => {
    const ee = new EventEmitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    ee.on("data", a);
    ee.on("count", b);
    ee.removeAllListeners();
    ee.emit("data", "x");
    ee.emit("count", 1);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("removeAllListeners(event) removes only listeners for that event", () => {
    const ee = new EventEmitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    ee.on("data", a);
    ee.on("count", b);
    ee.removeAllListeners("data");
    ee.emit("data", "x");
    ee.emit("count", 1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it("adding the same listener twice deduplicates (Set semantics)", () => {
    const ee = new EventEmitter<TestEvents>();
    const cb = vi.fn();
    ee.on("count", cb);
    ee.on("count", cb);
    ee.emit("count", 42);
    // Backed by a Set — same reference is stored once, called once
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("routes async and thenable observer failures to a sink without awaiting them", async () => {
    const ee = new EventEmitter<TestEvents>();
    const seen: unknown[] = [];
    ee.on("data", async () => {
      throw new Error("async observer");
    });
    ee.on("data", () => ({
      // biome-ignore lint/suspicious/noThenProperty: Exercise an intentional non-Promise thenable observer.
      then(_resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        reject("thenable observer");
      },
    }));
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    ee.emitObserved(
      (error) => {
        seen.push(error);
        if (seen.length === 2) finish();
      },
      "data",
      "value",
    );
    await completed;
    expect(seen).toEqual([new Error("async observer"), "thenable observer"]);
  });

  it("emit: a listener that subscribes a new listener mid-dispatch does not invoke it until the next emit", () => {
    const ee = new EventEmitter<TestEvents>();
    const late = vi.fn();
    ee.on("data", () => {
      ee.on("data", late);
    });
    ee.emit("data", "first");
    expect(late).not.toHaveBeenCalled();
    ee.emit("data", "second");
    expect(late).toHaveBeenCalledWith("second");
    expect(late).toHaveBeenCalledOnce();
  });

  it("emit: a listener that off()s a not-yet-invoked listener mid-dispatch suppresses it", () => {
    const ee = new EventEmitter<TestEvents>();
    const target = vi.fn();
    ee.on("data", () => {
      ee.off("data", target);
    });
    ee.on("data", target);
    ee.emit("data", "x");
    expect(target).not.toHaveBeenCalled();
  });

  it("emitObserved: a listener that subscribes a new listener mid-dispatch does not invoke it until the next emit", () => {
    const ee = new EventEmitter<TestEvents>();
    const late = vi.fn();
    ee.on("data", () => {
      ee.on("data", late);
    });
    const onError = vi.fn();
    ee.emitObserved(onError, "data", "first");
    expect(late).not.toHaveBeenCalled();
    ee.emitObserved(onError, "data", "second");
    expect(late).toHaveBeenCalledWith("second");
    expect(late).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("emitObserved: a listener that off()s a not-yet-invoked listener mid-dispatch suppresses it", () => {
    const ee = new EventEmitter<TestEvents>();
    const target = vi.fn();
    ee.on("data", () => {
      ee.off("data", target);
    });
    ee.on("data", target);
    ee.emitObserved(vi.fn(), "data", "x");
    expect(target).not.toHaveBeenCalled();
  });
});
