import type { NotificationsChannel } from "@palladium/notifications-core";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NotificationsProvider } from "../context.js";
import { usePermission } from "../use-permission.js";
import { createMockInstance } from "./helpers.js";

function makeWrapper(instance: ReturnType<typeof createMockInstance>) {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <NotificationsProvider instance={instance}>{children}</NotificationsProvider>;
  };
}

describe("usePermission", () => {
  it("returns 'not-applicable' when channel not configured", () => {
    const inst = createMockInstance();
    (inst.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const { result } = renderHook(() => usePermission("browser"), {
      wrapper: makeWrapper(inst),
    });
    expect(result.current).toBe("not-applicable");
  });

  it("returns initial channel permissionStatus", () => {
    const inst = createMockInstance();
    const mockCh = {
      permissionStatus: vi.fn().mockReturnValue("granted"),
      requestPermission: vi.fn().mockResolvedValue("granted"),
    } as unknown as NotificationsChannel;
    (inst.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(mockCh);
    (inst.on as ReturnType<typeof vi.fn>).mockReturnValue(() => {});

    const { result } = renderHook(() => usePermission("browser"), {
      wrapper: makeWrapper(inst),
    });
    expect(result.current).toBe("granted");
  });

  it("registers listener on mount", () => {
    const inst = createMockInstance();
    const mockCh = {
      permissionStatus: vi.fn().mockReturnValue("default"),
      requestPermission: vi.fn().mockResolvedValue("default"),
    } as unknown as NotificationsChannel;
    (inst.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(mockCh);
    (inst.on as ReturnType<typeof vi.fn>).mockReturnValue(() => {});

    renderHook(() => usePermission("browser"), {
      wrapper: makeWrapper(inst),
    });

    expect(inst.on).toHaveBeenCalledWith("delivered", expect.any(Function));
  });
});
