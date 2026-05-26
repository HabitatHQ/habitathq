import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { NotificationsProvider } from "../context.js";
import { useToast } from "../use-toast.js";
import { createMockInstance } from "./helpers.js";

function makeWrapper(instance: ReturnType<typeof createMockInstance>) {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <NotificationsProvider instance={instance}>{children}</NotificationsProvider>;
  };
}

describe("useToast", () => {
  it("returns stable reference across re-renders", () => {
    const inst = createMockInstance();
    const { result, rerender } = renderHook(() => useToast(), {
      wrapper: makeWrapper(inst),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("success() delegates to instance.toast.success", async () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useToast(), {
      wrapper: makeWrapper(inst),
    });
    await result.current.success("All good!");
    expect(inst.toast.success).toHaveBeenCalledWith("All good!");
  });

  it("error() delegates to instance.toast.error", async () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useToast(), {
      wrapper: makeWrapper(inst),
    });
    await result.current.error("Something broke");
    expect(inst.toast.error).toHaveBeenCalledWith("Something broke");
  });

  it("warning() delegates to instance.toast.warning", async () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useToast(), {
      wrapper: makeWrapper(inst),
    });
    await result.current.warning("Heads up");
    expect(inst.toast.warning).toHaveBeenCalledWith("Heads up");
  });

  it("info() delegates to instance.toast.info", async () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useToast(), {
      wrapper: makeWrapper(inst),
    });
    await result.current.info("FYI");
    expect(inst.toast.info).toHaveBeenCalledWith("FYI");
  });

  it("send() delegates to instance.toast.send", async () => {
    const inst = createMockInstance();
    const { result } = renderHook(() => useToast(), {
      wrapper: makeWrapper(inst),
    });
    await result.current.send({ title: "Direct" });
    expect(inst.toast.send).toHaveBeenCalledWith({ title: "Direct" });
  });
});
