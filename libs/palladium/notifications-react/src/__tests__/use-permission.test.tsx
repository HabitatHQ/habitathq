import {
  createNotifications,
  MockChannel,
  type NotificationsInstance,
  type PermissionState,
} from "@palladium/notifications-core";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NotificationsProvider } from "../context.js";
import { usePermission, useRequestPermission } from "../use-permission.js";

function makeWrapper(instance: NotificationsInstance) {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <NotificationsProvider instance={instance}>{children}</NotificationsProvider>;
  };
}

describe("notification permission consumers", () => {
  it.each(["granted", "denied"] as const)(
    "updates simultaneous permission hooks after requesting %s without sending",
    async (decision) => {
      const channel = new MockChannel("browser", { permissionState: "default" });
      vi.spyOn(channel, "requestPermission").mockImplementation(async () => {
        channel.setPermissionState(decision);
        return decision;
      });
      const instance = createNotifications({ channels: { browser: channel } });
      const wrapper = makeWrapper(instance);
      const first = renderHook(() => usePermission("browser"), { wrapper });
      const second = renderHook(() => usePermission("browser"), { wrapper });
      const request = renderHook(() => useRequestPermission("browser"), { wrapper });
      expect([first.result.current, second.result.current]).toEqual(["default", "default"]);
      let response: PermissionState | undefined;
      await act(async () => {
        response = await request.result.current();
      });
      expect(response).toBe(decision);
      expect([first.result.current, second.result.current]).toEqual([decision, decision]);
      expect(channel.sentNotifications).toEqual([]);
      first.unmount();
      second.unmount();
      request.unmount();
    },
  );
  it("detaches the previous instance when the provider changes", async () => {
    const previousChannel = new MockChannel("browser", { permissionState: "default" });
    vi.spyOn(previousChannel, "requestPermission").mockImplementation(async () => {
      previousChannel.setPermissionState("granted");
      return "granted";
    });
    const previous = createNotifications({ channels: { browser: previousChannel } });
    let instance = previous;
    function Wrapper({ children }: { children: ReactNode }) {
      return <NotificationsProvider instance={instance}>{children}</NotificationsProvider>;
    }
    const consumer = renderHook(() => usePermission("browser"), { wrapper: Wrapper });
    instance = createNotifications({
      channels: { browser: new MockChannel("browser", { permissionState: "denied" }) },
    });
    consumer.rerender();
    await act(async () => {
      await previous.browser.requestPermission();
    });
    expect(consumer.result.current).toBe("denied");
    consumer.unmount();
  });

  it("preserves permission when a request rejects and propagates the rejection", async () => {
    const channel = new MockChannel("browser", { permissionState: "default" });
    const failure = new Error("permission service unavailable");
    vi.spyOn(channel, "requestPermission").mockRejectedValue(failure);
    const instance = createNotifications({ channels: { browser: channel } });
    const consumer = renderHook(
      () => ({
        permission: usePermission("browser"),
        request: useRequestPermission("browser"),
      }),
      { wrapper: makeWrapper(instance) },
    );
    await act(async () => {
      await expect(consumer.result.current.request()).rejects.toBe(failure);
    });
    expect(consumer.result.current.permission).toBe("default");
    expect(channel.sentNotifications).toEqual([]);
    consumer.unmount();
  });

  it("preserves absent channel semantics for permission and request hooks", async () => {
    const instance = createNotifications();
    const consumer = renderHook(
      () => ({
        permission: usePermission("browser"),
        request: useRequestPermission("browser"),
      }),
      { wrapper: makeWrapper(instance) },
    );
    expect(consumer.result.current.permission).toBe("not-applicable");
    await expect(consumer.result.current.request()).resolves.toBe("not-applicable");
    consumer.unmount();
  });
});
