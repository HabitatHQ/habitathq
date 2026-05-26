import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NotificationsProvider } from "../context.js";
import { useNotifications } from "../use-notifications.js";
import { createMockInstance } from "./helpers.js";

function makeWrapper(instance: ReturnType<typeof createMockInstance>) {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <NotificationsProvider instance={instance}>{children}</NotificationsProvider>;
  };
}

describe("useNotifications", () => {
  it("returns object with notify, toast, browser", () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(inst),
    });
    expect(typeof result.current.notify).toBe("function");
    expect(typeof result.current.toast).toBe("object");
    expect(typeof result.current.browser).toBe("object");
  });

  it("notify() from hook returns builder", () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(inst),
    });
    const builder = result.current.notify("Hello");
    expect(typeof builder.send).toBe("function");
    expect(inst.notify).toHaveBeenCalledWith("Hello");
  });

  it("notify reference is stable across re-renders", () => {
    const inst = createMockInstance();
    const { result, rerender } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(inst),
    });
    const first = result.current.notify;
    rerender();
    expect(result.current.notify).toBe(first);
  });

  it("toast reference is stable across re-renders", () => {
    const inst = createMockInstance();
    const { result, rerender } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(inst),
    });
    const first = result.current.toast;
    rerender();
    expect(result.current.toast).toBe(first);
  });

  it("toast.success() calls instance.toast.success", async () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(inst),
    });
    await result.current.toast.success("Saved!");
    expect(inst.toast.success).toHaveBeenCalledWith("Saved!");
  });

  it("toast.error() calls instance.toast.error", async () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(inst),
    });
    await result.current.toast.error("Failed!");
    expect(inst.toast.error).toHaveBeenCalledWith("Failed!");
  });

  it("browser.send() calls instance.browser.send", async () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(inst),
    });
    await result.current.browser.send({ title: "Test" });
    expect(inst.browser.send).toHaveBeenCalledWith({ title: "Test" });
  });

  it("browser.requestPermission() calls instance.browser.requestPermission", async () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(inst),
    });
    await result.current.browser.requestPermission();
    expect(inst.browser.requestPermission).toHaveBeenCalledOnce();
  });

  it("use() calls instance.use", () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(inst),
    });
    const mw = vi.fn();
    result.current.use(mw);
    expect(inst.use).toHaveBeenCalledWith(mw);
  });

  it("on() calls instance.on", () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(inst),
    });
    const handler = vi.fn();
    result.current.on("delivered", handler);
    expect(inst.on).toHaveBeenCalledWith("delivered", handler);
  });

  it("getChannel() calls instance.getChannel", () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(inst),
    });
    result.current.getChannel("toast");
    expect(inst.getChannel).toHaveBeenCalledWith("toast");
  });
});
