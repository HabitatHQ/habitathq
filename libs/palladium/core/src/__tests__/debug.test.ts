import { afterEach, describe, expect, it, vi } from "vitest";
import { dbg, disableDebug, enableDebug, isDebugEnabled } from "../debug.js";

afterEach(() => {
  disableDebug();
});

describe("debug", () => {
  it("is disabled by default", () => {
    expect(isDebugEnabled()).toBe(false);
  });

  it("enableDebug activates logging", () => {
    enableDebug();
    expect(isDebugEnabled()).toBe(true);
  });

  it("disableDebug deactivates logging", () => {
    enableDebug();
    disableDebug();
    expect(isDebugEnabled()).toBe(false);
  });

  it("dbg is a no-op when disabled", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    dbg("test", "should not log");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("dbg logs via console.debug with default handler", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    enableDebug();
    dbg("scope", "hello");
    expect(spy).toHaveBeenCalledWith("[scope]", "hello");
    spy.mockRestore();
  });

  it("dbg includes JSON data when provided", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    enableDebug();
    dbg("scope", "msg", { foo: 1 });
    expect(spy).toHaveBeenCalledWith("[scope]", "msg", JSON.stringify({ foo: 1 }));
    spy.mockRestore();
  });

  it("uses custom log handler when provided", () => {
    const handler = vi.fn();
    enableDebug(handler);
    dbg("custom", "hello", { x: 42 });
    expect(handler).toHaveBeenCalledWith("custom", "hello", { x: 42 });
  });

  it("custom handler is discarded on disableDebug", () => {
    const handler = vi.fn();
    enableDebug(handler);
    disableDebug();
    dbg("custom", "after-disable");
    expect(handler).not.toHaveBeenCalled();
  });
});
