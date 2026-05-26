import { describe, expect, it, vi } from "vitest";
import type { NotificationEventMap } from "../events.js";
import { NotificationsEventEmitter } from "../events.js";

describe("NotificationsEventEmitter", () => {
  it("on() + emit() calls handler with correct payload", () => {
    const emitter = new NotificationsEventEmitter();
    const handler = vi.fn();
    const payload: NotificationEventMap["delivered"] = {
      channel: "toast",
      notification: { title: "Test" },
    };
    emitter.on("delivered", handler);
    emitter.emit("delivered", payload);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("on() returns unsubscribe; after calling it handler is not invoked", () => {
    const emitter = new NotificationsEventEmitter();
    const handler = vi.fn();
    const unsub = emitter.on("delivered", handler);
    unsub();
    emitter.emit("delivered", { channel: "toast", notification: { title: "Test" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("multiple handlers for the same event are all called", () => {
    const emitter = new NotificationsEventEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on("error", h1);
    emitter.on("error", h2);
    const payload: NotificationEventMap["error"] = {
      channel: "browser",
      error: new Error("oops"),
      notification: { title: "Test" },
    };
    emitter.emit("error", payload);
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("unsubscribing one handler does not affect others", () => {
    const emitter = new NotificationsEventEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    const unsub1 = emitter.on("delivered", h1);
    emitter.on("delivered", h2);
    unsub1();
    emitter.emit("delivered", { channel: "toast", notification: { title: "X" } });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("handler for a different event is not called", () => {
    const emitter = new NotificationsEventEmitter();
    const handler = vi.fn();
    emitter.on("dismissed", handler);
    emitter.emit("delivered", { channel: "toast", notification: { title: "Test" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("emit() for an event with no handlers does not throw", () => {
    const emitter = new NotificationsEventEmitter();
    expect(() => {
      emitter.emit("beforesend", {
        notification: { title: "Test" },
        channels: ["toast"],
      });
    }).not.toThrow();
  });

  it("subscribing and emitting beforesend works correctly", () => {
    const emitter = new NotificationsEventEmitter();
    const handler = vi.fn();
    emitter.on("beforesend", handler);
    const payload: NotificationEventMap["beforesend"] = {
      notification: { title: "Hi" },
      channels: ["toast", "browser"],
    };
    emitter.emit("beforesend", payload);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("clicked event includes optional actionId", () => {
    const emitter = new NotificationsEventEmitter();
    const handler = vi.fn();
    emitter.on("clicked", handler);
    const payload: NotificationEventMap["clicked"] = {
      channel: "browser",
      notification: { title: "Clicked" },
      actionId: "view",
    };
    emitter.emit("clicked", payload);
    expect(handler).toHaveBeenCalledWith(payload);
  });
});
